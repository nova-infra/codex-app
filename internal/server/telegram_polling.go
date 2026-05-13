package server

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
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
	SendMessage(ctx context.Context, msg channelapi.RuntimeMessage) (int64, error)
	EditMessageText(ctx context.Context, chatID string, messageID int64, text string) error
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
	text := strings.TrimSpace(update.Payload)
	if strings.EqualFold(strings.TrimSpace(os.Getenv("CODEX_APP_DISABLE_CODEX")), "true") || strings.HasPrefix(text, "/") {
		reply := kernel.HandleIncomingMessage(kernel.IncomingMessage{Channel: "telegram", ChatID: update.ChannelID, MessageID: fmt.Sprintf("%d", update.UpdateID), Text: text})
		return r.runtime.Send(ctx, channelapi.RuntimeMessage{ChannelID: update.ChannelID, Text: reply})
	}
	return r.streamTelegramReply(ctx, update.ChannelID, text, codex.NewStreamingResponderFromEnvWithSession(update.ChannelID))
}

func (r *telegramPollingRunner) streamTelegramReply(ctx context.Context, chatID string, text string, responder codex.StreamingResponder) error {
	var (
		mu           sync.Mutex
		sent         bool
		messageID    int64
		current      strings.Builder
		streamErr    error
		finalReply   string
		lastEditTime time.Time
		lastFlushed  int
	)
	onDelta := func(delta string) {
		delta = strings.TrimSpace(delta)
		if delta == "" {
			return
		}
		mu.Lock()
		defer mu.Unlock()
		if streamErr != nil {
			return
		}
		current.WriteString(delta)
		text := strings.TrimSpace(current.String())
		if text == "" {
			return
		}
		if !sent {
			id, err := r.runtime.SendMessage(ctx, channelapi.RuntimeMessage{ChannelID: chatID, Text: text})
			if err != nil {
				streamErr = err
				return
			}
			messageID = id
			sent = true
			lastFlushed = len(text)
			lastEditTime = time.Now()
			slog.Info("telegram streaming reply sent", "chat_id", chatID, "message_id", messageID, "chars", len([]rune(text)))
			return
		}
		now := time.Now()
		if len(text)-lastFlushed < 40 && now.Sub(lastEditTime) < time.Second {
			return
		}
		if err := r.runtime.EditMessageText(ctx, chatID, messageID, text); err != nil {
			streamErr = err
			return
		}
		lastFlushed = len(text)
		lastEditTime = now
		slog.Info("telegram streaming reply updated", "chat_id", chatID, "message_id", messageID, "chars", len([]rune(text)))
	}
	reply, err := responder.StreamRespond(ctx, text, onDelta)
	mu.Lock()
	defer mu.Unlock()
	finalReply = strings.TrimSpace(reply)
	if finalReply == "" {
		finalReply = strings.TrimSpace(current.String())
	}
	if sent && streamErr == nil && finalReply != "" && finalReply != strings.TrimSpace(current.String()) {
		if err := r.runtime.EditMessageText(ctx, chatID, messageID, finalReply); err != nil {
			streamErr = err
		}
	}
	if streamErr != nil {
		if finalReply == "" {
			finalReply = strings.TrimSpace(current.String())
		}
		if finalReply != "" {
			if sendErr := r.runtime.Send(ctx, channelapi.RuntimeMessage{ChannelID: chatID, Text: finalReply}); sendErr != nil {
				return streamErr
			}
			return nil
		}
		return streamErr
	}
	if !sent {
		if finalReply == "" {
			return err
		}
		if sendErr := r.runtime.Send(ctx, channelapi.RuntimeMessage{ChannelID: chatID, Text: finalReply}); sendErr != nil {
			return sendErr
		}
	}
	return err
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
