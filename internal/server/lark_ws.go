package server

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"

	larkcore "github.com/larksuite/oapi-sdk-go/v3/core"
	"github.com/larksuite/oapi-sdk-go/v3/event/dispatcher"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
	larkws "github.com/larksuite/oapi-sdk-go/v3/ws"

	"github.com/nova-infra/codex-app/internal/channelapi"
)

type larkWSRunner struct {
	client  *larkws.Client
	started bool
	mu      sync.Mutex
	status  string
}

func newLarkWSRunner(service larkEventService) (*larkWSRunner, error) {
	if !service.ready() {
		return nil, nil
	}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("LARK_WS_DISABLED")), "true") {
		return nil, nil
	}
	runner := &larkWSRunner{status: "initialized"}
	handler := dispatcher.NewEventDispatcher("", "").
		OnP2MessageReceiveV1(func(ctx context.Context, event *larkim.P2MessageReceiveV1) error {
			message, ok := larkWSMessage(event)
			if !ok {
				slog.Info("lark websocket event ignored")
				return nil
			}
			slog.Info("lark websocket message received", "chat_id", message.ChatID, "message_id", message.MessageID, "type", message.MessageType)
			if err := service.replyContext(ctx, message); err != nil {
				slog.Error("lark websocket reply failed", "error", err)
				return err
			}
			slog.Info("lark websocket message replied", "message_id", message.MessageID)
			return nil
		})
	opts := []larkws.ClientOption{
		larkws.WithEventHandler(handler),
		larkws.WithLogLevel(larkcore.LogLevelInfo),
		larkws.WithLogger(larkWSLogger{onLog: runner.observeSDKLog}),
	}
	if base := strings.TrimSpace(service.runtime.Config.APIBase); base != "" {
		// The SDK defaults to Feishu. Always pass the configured domain so Lark
		// international apps connect to open.larksuite.com, matching cc-connect.
		opts = append(opts, larkws.WithDomain(base))
	}
	runner.client = larkws.NewClient(service.runtime.Config.AppID, service.runtime.Config.AppSecret, opts...)
	return runner, nil
}

func (r *larkWSRunner) start(ctx context.Context) {
	if r == nil || r.client == nil || r.started {
		return
	}
	r.started = true
	r.setStatus("connecting")
	slog.Info("lark websocket starting")
	go func() {
		if err := r.client.Start(ctx); err != nil && ctx.Err() == nil {
			r.setStatus("stopped_error")
			slog.Error("lark websocket stopped", "error", err)
			return
		}
		if ctx.Err() != nil {
			r.setStatus("stopped_context")
		}
	}()
}

func (r *larkWSRunner) observeSDKLog(level slog.Level, msg string) {
	lower := strings.ToLower(msg)
	if strings.Contains(lower, "connected to ") {
		r.setStatus("connected")
		return
	}
	if level >= slog.LevelError && strings.Contains(lower, "connect failed") {
		r.setStatus("connect_error")
	}
}

func (r *larkWSRunner) setStatus(status string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.status = status
}

func larkWSMessage(event *larkim.P2MessageReceiveV1) (larkEventMessage, bool) {
	if event == nil || event.Event == nil || event.Event.Message == nil {
		return larkEventMessage{}, false
	}
	if event.Event.Sender != nil && event.Event.Sender.SenderType != nil && strings.EqualFold(*event.Event.Sender.SenderType, "app") {
		return larkEventMessage{}, false
	}
	msg := event.Event.Message
	out := larkEventMessage{
		ChatID:      stringPtr(msg.ChatId),
		MessageID:   stringPtr(msg.MessageId),
		MessageType: stringPtr(msg.MessageType),
		Content:     stringPtr(msg.Content),
	}
	if strings.TrimSpace(out.ChatID) == "" {
		return larkEventMessage{}, false
	}
	if strings.TrimSpace(out.MessageID) == "" {
		return larkEventMessage{}, false
	}
	if out.MessageType != "" && out.MessageType != "text" {
		return larkEventMessage{}, false
	}
	return out, true
}

func stringPtr(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func (s larkEventService) replyContext(ctx context.Context, message larkEventMessage) error {
	stopLoading := s.startLoadingReaction(message.MessageID)
	defer stopLoading()
	text := buildLarkReply(ctx, message)
	if strings.TrimSpace(message.MessageID) != "" {
		return s.runtime.Reply(ctx, message.MessageID, text)
	}
	if strings.TrimSpace(message.ChatID) == "" {
		return fmt.Errorf("lark message missing chat_id")
	}
	return s.runtime.Send(ctx, channelapi.RuntimeMessage{ChannelID: message.ChatID, Text: text})
}

func (s larkEventService) startLoadingReaction(messageID string) func() {
	messageID = strings.TrimSpace(messageID)
	if messageID == "" || s.runtime == nil {
		return func() {}
	}
	emoji := loadingReactionEmoji()
	if emoji == "" {
		return func() {}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	reactionID, err := s.runtime.AddReaction(ctx, messageID, emoji)
	cancel()
	if err != nil {
		slog.Debug("lark loading reaction add failed", "error", err)
		return func() {}
	}
	return func() {
		if reactionID == "" {
			return
		}
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := s.runtime.DeleteReaction(ctx, messageID, reactionID); err != nil {
				slog.Debug("lark loading reaction delete failed", "error", err)
			}
		}()
	}
}

func loadingReactionEmoji() string {
	value := strings.TrimSpace(os.Getenv("LARK_LOADING_REACTION_EMOJI"))
	if strings.EqualFold(value, "none") {
		return ""
	}
	if value != "" {
		return value
	}
	return "OnIt"
}

func (r *larkWSRunner) healthStatus() string {
	if r == nil {
		return "disabled"
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.status == "" {
		return "created"
	}
	return r.status
}
