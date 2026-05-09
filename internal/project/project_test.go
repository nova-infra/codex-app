package project

import (
	"strings"
	"testing"
)

func TestDefaultProject(t *testing.T) {
	cfg := Default()
	if cfg.Name == "" {
		t.Fatal("default name is required")
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("default config should validate: %v", err)
	}
}

func TestProjectValidateRequiresName(t *testing.T) {
	cfg := Default()
	cfg.Name = ""
	if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), "name") {
		t.Fatalf("expected name validation error, got %v", err)
	}
}

func TestProjectValidatePlatformAlias(t *testing.T) {
	cfg := Default()
	cfg.Platforms = []string{"weixin"}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected weixin alias to be valid: %v", err)
	}
}

func TestProjectValidateDuplicatePlatform(t *testing.T) {
	cfg := Default()
	cfg.Platforms = []string{"telegram", "telegram"}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected duplicate platform validation error")
	}
}

func TestProjectValidateProviderRefs(t *testing.T) {
	cfg := Default()
	cfg.ProviderRefs = []string{""}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected provider_ref validation error")
	}
}

func TestProjectListDemo(t *testing.T) {
	got := ListDemo()
	if len(got) == 0 {
		t.Fatal("expected demo project names")
	}
	if got[0] != "default" {
		t.Fatalf("unexpected demo project name: %q", got[0])
	}
}
