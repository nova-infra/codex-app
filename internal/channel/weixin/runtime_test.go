package weixin

import (
	"context"
	"testing"

	"github.com/nova-infra/codex-app/internal/channelapi"
)

func TestWeixinRuntimeValidate(t *testing.T) {
	_, err := NewRuntime(RuntimeConfig{CorpID: "corp", CorpSecret: "secret", AgentID: "agent"})
	if err != nil {
		t.Fatalf("runtime valid: %v", err)
	}
}

func TestWeixinRuntimeSendRequiresChannelID(t *testing.T) {
	rt, err := NewRuntime(RuntimeConfig{CorpID: "corp", CorpSecret: "secret", AgentID: "agent"})
	if err != nil {
		t.Fatalf("init runtime: %v", err)
	}
	if err := rt.Send(context.Background(), channelapi.RuntimeMessage{}); err == nil {
		t.Fatal("expected channel id validation error")
	}
}
