package server

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/nova-infra/codex-app/internal/channel/weixin"
	"github.com/nova-infra/codex-app/internal/channelapi"
	"github.com/nova-infra/codex-app/internal/codex"
	"github.com/nova-infra/codex-app/internal/kernel"
)

type weixinPollingRunner struct {
	runtime weixinPollRuntime
	started bool
	status  string
	cursor  string
}

type weixinPollRuntime interface {
	Send(ctx context.Context, msg channelapi.RuntimeMessage) error
	GetUpdatesPage(ctx context.Context, cursor string, limit int, timeoutMs int) (weixin.UpdatesPage, error)
}

func newWeixinPollingRunner(channels []string) (*weixinPollingRunner, error) {
	if !hasAnyChannel(channels, "wechat", "weixin") {
		return nil, nil
	}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("WEIXIN_POLLING_DISABLED")), "true") {
		return nil, nil
	}
	runtime, err := weixin.NewRuntimeFromEnv()
	if err != nil {
		return nil, nil
	}
	if strings.TrimSpace(runtime.Config.BotToken) == "" {
		return nil, nil
	}
	return &weixinPollingRunner{runtime: runtime, status: "initialized"}, nil
}

func (r *weixinPollingRunner) start(ctx context.Context) {
	if r == nil || r.runtime == nil || r.started {
		return
	}
	r.started = true
	r.status = "starting"
	slog.Info("weixin polling starting")
	go r.loop(ctx)
}

func (r *weixinPollingRunner) loop(ctx context.Context) {
	r.status = "running"
	for {
		select {
		case <-ctx.Done():
			r.status = "stopped_context"
			return
		default:
		}
		page, err := r.runtime.GetUpdatesPage(ctx, r.cursor, 10, 38000)
		if err != nil {
			if ctx.Err() != nil {
				r.status = "stopped_context"
				return
			}
			r.status = "poll_error"
			slog.Error("weixin polling failed", "error", err)
			time.Sleep(3 * time.Second)
			continue
		}
		if cursor := strings.TrimSpace(page.Cursor); cursor != "" {
			r.cursor = cursor
		}
		r.status = "running"
		r.handleUpdates(ctx, page.Updates)
		if len(page.Updates) == 0 {
			time.Sleep(500 * time.Millisecond)
		}
	}
}

func (r *weixinPollingRunner) handleUpdates(ctx context.Context, updates []channelapi.RuntimeUpdate) {
	for _, update := range updates {
		r.advanceCursor(update)
		slog.Info("weixin message received", "update_id", update.UpdateID, "channel_id", update.ChannelID)
		if err := r.reply(ctx, update); err != nil {
			slog.Error("weixin reply failed", "update_id", update.UpdateID, "error", err)
			continue
		}
		slog.Info("weixin message replied", "update_id", update.UpdateID, "channel_id", update.ChannelID)
	}
}

func (r *weixinPollingRunner) advanceCursor(update channelapi.RuntimeUpdate) {
	if update.Metadata == nil {
		return
	}
	if cursor := strings.TrimSpace(update.Metadata["cursor"]); cursor != "" {
		r.cursor = cursor
	}
}

func (r *weixinPollingRunner) reply(ctx context.Context, update channelapi.RuntimeUpdate) error {
	if strings.TrimSpace(update.ChannelID) == "" {
		return fmt.Errorf("weixin update missing channel_id")
	}
	text := buildWeixinReply(ctx, update)
	return r.runtime.Send(ctx, channelapi.RuntimeMessage{
		ChannelID: update.ChannelID,
		Text:      text,
		Metadata:  update.Metadata,
	})
}

func buildWeixinReply(ctx context.Context, update channelapi.RuntimeUpdate) string {
	text := strings.TrimSpace(update.Payload)
	if strings.EqualFold(strings.TrimSpace(os.Getenv("CODEX_APP_DISABLE_CODEX")), "true") || strings.HasPrefix(text, "/") {
		return kernel.HandleIncomingMessage(kernel.IncomingMessage{Channel: "wechat", ChatID: update.ChannelID, MessageID: fmt.Sprintf("%d", update.UpdateID), Text: text})
	}
	reply, err := codex.NewExecResponderFromEnv().Respond(ctx, text)
	if err != nil {
		return "Codex 暂时不可用：" + err.Error()
	}
	return reply
}

func (r *weixinPollingRunner) healthStatus() string {
	if r == nil {
		return "disabled"
	}
	if r.status == "" {
		return "created"
	}
	return r.status
}

func hasAnyChannel(channels []string, targets ...string) bool {
	for _, target := range targets {
		if hasChannel(channels, target) {
			return true
		}
	}
	return false
}
