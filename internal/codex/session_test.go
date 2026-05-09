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

func TestBuildLaunchCommand(t *testing.T) {
	cfg := config.Default()
	cfg.Providers[0].APIKey = "secret"
	cmd, err := BuildLaunchCommand(cfg.Projects[0], cfg.Providers[0])
	if err != nil {
		t.Fatalf("launch command err: %v", err)
	}
	if cmd.Executable != "codex" {
		t.Fatalf("unexpected executable: %q", cmd.Executable)
	}
	if cmd.Env["CODEX_HOME"] == "" || cmd.Env["OPENAI_API_KEY"] != "secret" {
		t.Fatalf("unexpected env: %#v", cmd.Env)
	}
}
