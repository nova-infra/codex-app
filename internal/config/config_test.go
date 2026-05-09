package config

import (
	"encoding/json"
	"os"
	"path/filepath"
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

func TestLoadDefaultConfig(t *testing.T) {
	loaded, err := Load("")
	if err != nil {
		t.Fatalf("load default: %v", err)
	}
	if loaded.Source != "default" {
		t.Fatalf("unexpected source: %q", loaded.Source)
	}
}

func TestLoadConfigFile(t *testing.T) {
	cfg := Default()
	cfg.Projects[0].Name = "custom"
	body, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "codex-app.json")
	if err := os.WriteFile(path, body, 0o600); err != nil {
		t.Fatal(err)
	}
	loaded, err := Load(path)
	if err != nil {
		t.Fatalf("load file: %v", err)
	}
	if loaded.Config.Projects[0].Name != "custom" {
		t.Fatalf("unexpected project name: %q", loaded.Config.Projects[0].Name)
	}
}

func TestApplyEnvProviderAPIKey(t *testing.T) {
	t.Setenv("CODEX_APP_PROVIDER_CLIPROXY_API_KEY", "secret")
	cfg := ApplyEnv(Default())
	if cfg.Providers[0].APIKey != "secret" {
		t.Fatalf("expected api key from env, got %q", cfg.Providers[0].APIKey)
	}
}

func TestDefaultConfigRuntimeCompatibility(t *testing.T) {
	cfg := Default()
	rt := DefaultRuntime()
	if cfg.DefaultChannel != rt.DefaultChannel {
		t.Fatalf("config default channel mismatch: %q != %q", cfg.DefaultChannel, rt.DefaultChannel)
	}
	if len(cfg.EnabledChannels) != len(rt.EnabledChannels) {
		t.Fatalf("config enabled channels length mismatch: %d != %d", len(cfg.EnabledChannels), len(rt.EnabledChannels))
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
