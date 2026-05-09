package codex

import "testing"

import (
	"github.com/nova-infra/codex-app/internal/config"
)

func TestBuildRuntimeBridgePayload(t *testing.T) {
	cfg := config.Default()
	sess, err := BuildRuntimeBridgePayload(cfg.Projects[0], cfg.Providers[0].Name)
	if err != nil {
		t.Fatalf("payload err: %v", err)
	}
	if sess.ProjectName == "" || sess.Provider == "" {
		t.Fatal("expected project and provider")
	}
}
