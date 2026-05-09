package server

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/nova-infra/codex-app/internal/channel/telegram"
	"github.com/nova-infra/codex-app/internal/channelapi"
	"github.com/nova-infra/codex-app/internal/codex"
	"github.com/nova-infra/codex-app/internal/kernel"
)

type telegramPollingRunner struct {
	runtime telegramPollRuntime
	started bool
	status  string
	offset  int64
}

type telegramPollRuntime interface {
	Send(ctx context.Context, msg channelapi.RuntimeMessage) error
	GetUpdatesSince(ctx context.Context, offset int64, limit int, timeout int) ([]channelapi.RuntimeUpdate, error)
}

func newTelegramPollingRunner(channels []string) (*telegramPollingRunner, error) {
	if !hasChannel(channels, "telegram") {
		return nil, nil
	}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("TELEGRAM_POLLING_DISABLED")), "true") {
		return nil, nil
	}
	runtime, err := telegram.NewRuntimeFromEnv()
	if err != nil {
		return nil, nil
	}
	return &telegramPollingRunner{runtime: runtime, status: "initialized"}, nil
}

func (r *telegramPollingRunner) start(ctx context.Context) {
	if r == nil || r.runtime == nil || r.started {
		return
	}
	r.started = true
	r.status = "starting"
	slog.Info("telegram polling starting")
	go r.loop(ctx)
}

func (r *telegramPollingRunner) loop(ctx context.Context) {
	r.status = "running"
	for {
		select {
		case <-ctx.Done():
			r.status = "stopped_context"
			return
		default:
		}
		updates, err := r.runtime.GetUpdatesSince(ctx, r.offset, 10, 20)
		if err != nil {
			if ctx.Err() != nil {
				r.status = "stopped_context"
				return
			}
			r.status = "poll_error"
			slog.Error("telegram polling failed", "error", err)
			time.Sleep(3 * time.Second)
			continue
		}
		r.status = "running"
		r.handleUpdates(ctx, updates)
		if len(updates) == 0 {
			time.Sleep(500 * time.Millisecond)
		}
	}
}

func (r *telegramPollingRunner) handleUpdates(ctx context.Context, updates []channelapi.RuntimeUpdate) {
	for _, update := range updates {
		if update.UpdateID >= r.offset {
			r.offset = update.UpdateID + 1
		}
		slog.Info("telegram message received", "update_id", update.UpdateID, "chat_id", update.ChannelID)
		if err := r.reply(ctx, update); err != nil {
			slog.Error("telegram reply failed", "update_id", update.UpdateID, "error", err)
			continue
		}
		slog.Info("telegram message replied", "update_id", update.UpdateID, "chat_id", update.ChannelID)
	}
}

func (r *telegramPollingRunner) reply(ctx context.Context, update channelapi.RuntimeUpdate) error {
	if strings.TrimSpace(update.ChannelID) == "" {
		return fmt.Errorf("telegram update missing channel_id")
	}
	text := buildTelegramReply(ctx, update)
	return r.runtime.Send(ctx, channelapi.RuntimeMessage{ChannelID: update.ChannelID, Text: text})
}

func buildTelegramReply(ctx context.Context, update channelapi.RuntimeUpdate) string {
	text := strings.TrimSpace(update.Payload)
	if strings.EqualFold(strings.TrimSpace(os.Getenv("CODEX_APP_DISABLE_CODEX")), "true") || strings.HasPrefix(text, "/") {
		return kernel.HandleIncomingMessage(kernel.IncomingMessage{Channel: "telegram", ChatID: update.ChannelID, MessageID: fmt.Sprintf("%d", update.UpdateID), Text: text})
	}
	reply, err := codex.NewExecResponderFromEnv().Respond(ctx, text)
	if err != nil {
		return "Codex 暂时不可用：" + err.Error()
	}
	return reply
}

func (r *telegramPollingRunner) healthStatus() string {
	if r == nil {
		return "disabled"
	}
	if r.status == "" {
		return "created"
	}
	return r.status
}

func hasChannel(channels []string, target string) bool {
	for _, channel := range channels {
		if strings.EqualFold(strings.TrimSpace(channel), target) {
			return true
		}
	}
	return false
}
