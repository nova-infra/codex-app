package lark

import (
	"context"
	"testing"

	"github.com/nova-infra/codex-app/internal/channelapi"
)

func TestLarkRuntimeValidate(t *testing.T) {
	_, err := NewRuntime(RuntimeConfig{AppID: "id", AppKey: "key", APIBase: "https://open.larkoffice.com"})
	if err != nil {
		t.Fatalf("runtime valid: %v", err)
	}
}

func TestLarkRuntimeGetUpdatesRejectNegative(t *testing.T) {
	rt, err := NewRuntime(RuntimeConfig{AppID: "id", AppKey: "key", APIBase: "https://open.larkoffice.com"})
	if err != nil {
		t.Fatalf("init runtime: %v", err)
	}
	if _, err := rt.GetUpdates(context.Background(), -1); err == nil {
		t.Fatal("expected negative limit validation error")
	}
}

func TestLarkRuntimeSendRejectEmptyMessage(t *testing.T) {
	rt, err := NewRuntime(RuntimeConfig{AppID: "id", AppKey: "key", APIBase: "https://open.larkoffice.com"})
	if err != nil {
		t.Fatalf("init runtime: %v", err)
	}
	if err := rt.Send(context.Background(), channelapi.RuntimeMessage{}); err == nil {
		t.Fatal("expected text validation error")
	}
}
