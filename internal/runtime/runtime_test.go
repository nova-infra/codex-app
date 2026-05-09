package runtime

import (
	"testing"

	"github.com/nova-infra/codex-app/internal/config"
)

func TestBuildStartupPlanFromConfigUsesFirstProject(t *testing.T) {
	cfg := config.Default()
	plan, err := BuildStartupPlanFromConfig(cfg, "")
	if err != nil {
		t.Fatalf("plan error: %v", err)
	}
	if plan.Project == "" {
		t.Fatal("expected project")
	}
}

func TestResolveAndValidateProjectCodexHome(t *testing.T) {
	cfg := config.Default()
	got, err := ResolveAndValidateProjectCodexHome(cfg.Projects[0])
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got == "" {
		t.Fatal("expected project codex_home")
	}
}
