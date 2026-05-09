package runtime

import (
	"testing"

	"github.com/nova-infra/codex-app/internal/config"
)

func TestBuildStartupPlanFromConfigUsesFirstProject(t *testing.T) {
	cfg := config.Default()
	cfg.Providers[0].APIKey = "secret"
	plan, err := BuildStartupPlanFromConfig(cfg, "")
	if err != nil {
		t.Fatalf("plan error: %v", err)
	}
	if plan.Project == "" {
		t.Fatal("expected project")
	}
	if plan.LaunchCommand == nil {
		t.Fatal("expected codex launch command preview")
	}
	if plan.LaunchCommand.Executable != "codex" {
		t.Fatalf("unexpected executable: %q", plan.LaunchCommand.Executable)
	}
	if got := plan.LaunchCommand.Env["OPENAI_API_KEY"]; got != "<redacted>" {
		t.Fatalf("expected redacted api key, got %q", got)
	}
	if plan.ProviderConfig == nil {
		t.Fatal("expected provider config preview")
	}
	if plan.ProviderConfig.APIKeyPresent != true {
		t.Fatalf("expected provider config to note api key presence: %#v", plan.ProviderConfig)
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
