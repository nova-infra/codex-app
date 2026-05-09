package config

import (
	"testing"

	"github.com/nova-infra/codex-app/internal/project"
	"github.com/nova-infra/codex-app/internal/provider"
)

func TestDefaultConfig(t *testing.T) {
	cfg := Default()
	if cfg.DataDir == "" {
		t.Fatal("default data dir is required")
	}
	if len(cfg.Providers) != 1 {
		t.Fatalf("expected exactly one default provider, got %d", len(cfg.Providers))
	}
	if len(cfg.Projects) != 1 {
		t.Fatalf("expected exactly one default project, got %d", len(cfg.Projects))
	}
}

func TestConfigValidate(t *testing.T) {
	cfg := Default()
	if err := cfg.Validate(); err != nil {
		t.Fatalf("default config should validate: %v", err)
	}
}

func TestConfigValidateRejectUnknownProviderRef(t *testing.T) {
	cfg := Default()
	cfg.Projects[0].ProviderRefs = []string{"not-exist"}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected unknown provider ref validation error")
	}
}

func TestConfigListDemoFunctions(t *testing.T) {
	if got := ListDemoProviders(); len(got) == 0 || got[0] != provider.ListDemo()[0] {
		t.Fatalf("providers list mismatch: %v", got)
	}
	if got := ListDemoProjects(); len(got) == 0 || got[0] != project.ListDemo()[0] {
		t.Fatalf("projects list mismatch: %v", got)
	}
}
