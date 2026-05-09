package telegram

import (
	"context"
	"testing"

	"github.com/nova-infra/codex-app/internal/channelapi"
)

func TestTelegramRuntimeValidate(t *testing.T) {
	_, err := NewRuntime(RuntimeConfig{BotToken: "x", APIBase: "https://api.telegram.org"})
	if err != nil {
		t.Fatalf("expected runtime config valid: %v", err)
	}
}

func TestTelegramRuntimeSendRejectEmptyMessage(t *testing.T) {
	rt, err := NewRuntime(RuntimeConfig{BotToken: "x", APIBase: "https://api.telegram.org"})
	if err != nil {
		t.Fatalf("init runtime: %v", err)
	}
	if err := rt.Send(context.Background(), channelapi.RuntimeMessage{}); err == nil {
		t.Fatal("expected send validation error")
	}
}
