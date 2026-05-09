package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/nova-infra/codex-app/internal/channel/lark"
	"github.com/nova-infra/codex-app/internal/channelapi"
	"github.com/nova-infra/codex-app/internal/codex"
	"github.com/nova-infra/codex-app/internal/kernel"
)

type larkEventService struct {
	runtime *lark.Runtime
}

type larkSendRequest struct {
	ChatID string `json:"chat_id"`
	Text   string `json:"text"`
}

type larkEventEnvelope struct {
	Type      string          `json:"type"`
	Challenge string          `json:"challenge"`
	Token     string          `json:"token"`
	Header    larkEventHeader `json:"header"`
	Event     larkEventBody   `json:"event"`
}

type larkEventHeader struct {
	EventType string `json:"event_type"`
	Token     string `json:"token"`
}

type larkEventBody struct {
	Sender  larkEventSender  `json:"sender"`
	Message larkEventMessage `json:"message"`
}

type larkEventSender struct {
	SenderType string `json:"sender_type"`
}

type larkEventMessage struct {
	ChatID      string `json:"chat_id"`
	MessageID   string `json:"message_id"`
	MessageType string `json:"message_type"`
	Content     string `json:"content"`
}

func newLarkEventService() larkEventService {
	runtime, err := lark.NewRuntimeFromEnv()
	if err != nil {
		return larkEventService{}
	}
	return larkEventService{runtime: runtime}
}

func (s larkEventService) ready() bool {
	return s.runtime != nil
}

func (s larkEventService) handleSend(w http.ResponseWriter, req *http.Request) {
	if !s.ready() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "lark runtime is not configured"})
		return
	}
	var payload larkSendRequest
	if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid json: " + err.Error()})
		return
	}
	if err := s.runtime.Send(req.Context(), channelapi.RuntimeMessage{ChannelID: payload.ChatID, Text: payload.Text}); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s larkEventService) handleEvent(w http.ResponseWriter, req *http.Request) {
	body, err := io.ReadAll(req.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	envelope, err := parseLarkEnvelope(body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	if !s.ready() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "lark runtime is not configured"})
		return
	}
	if err := s.verify(envelope); err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	if envelope.Challenge != "" {
		writeJSON(w, http.StatusOK, map[string]string{"challenge": envelope.Challenge})
		return
	}
	message, ok := extractLarkIncomingMessage(envelope)
	if !ok {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "ignored": true})
		return
	}
	if err := s.reply(req, message); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "replied": true})
}

func (s larkEventService) reply(req *http.Request, message larkEventMessage) error {
	return s.replyContext(req.Context(), message)
}

func (s larkEventService) verify(envelope larkEventEnvelope) error {
	want := strings.TrimSpace(s.runtime.Config.VerificationToken)
	if want == "" {
		return nil
	}
	got := strings.TrimSpace(envelope.Token)
	if got == "" {
		got = strings.TrimSpace(envelope.Header.Token)
	}
	if got != want {
		return fmt.Errorf("lark verification token mismatch")
	}
	return nil
}

func parseLarkEnvelope(body []byte) (larkEventEnvelope, error) {
	var envelope larkEventEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return larkEventEnvelope{}, err
	}
	return envelope, nil
}

func extractLarkIncomingMessage(envelope larkEventEnvelope) (larkEventMessage, bool) {
	eventType := strings.TrimSpace(envelope.Header.EventType)
	if eventType == "" {
		eventType = strings.TrimSpace(envelope.Type)
	}
	if eventType != "im.message.receive_v1" {
		return larkEventMessage{}, false
	}
	if strings.EqualFold(envelope.Event.Sender.SenderType, "app") {
		return larkEventMessage{}, false
	}
	msg := envelope.Event.Message
	if strings.TrimSpace(msg.ChatID) == "" {
		return larkEventMessage{}, false
	}
	return msg, true
}

func buildLarkReply(ctx context.Context, message larkEventMessage) string {
	text := extractLarkText(message.Content)
	if strings.EqualFold(strings.TrimSpace(os.Getenv("CODEX_APP_DISABLE_CODEX")), "true") || strings.HasPrefix(strings.TrimSpace(text), "/") {
		return kernel.HandleIncomingMessage(kernel.IncomingMessage{Channel: "lark", ChatID: message.ChatID, MessageID: message.MessageID, Text: text})
	}
	reply, err := codex.NewExecResponderFromEnv().Respond(ctx, text)
	if err != nil {
		return "Codex 暂时不可用：" + err.Error()
	}
	return reply
}

func extractLarkText(content string) string {
	var payload map[string]any
	if err := json.Unmarshal([]byte(content), &payload); err != nil {
		return strings.TrimSpace(content)
	}
	value, ok := payload["text"].(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(value)
}
