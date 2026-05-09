package provider

import (
	"strings"
	"testing"
)

func TestDefaultProvider(t *testing.T) {
	cfg := Default()
	if cfg.Name == "" {
		t.Fatal("default name is required")
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("default config should validate: %v", err)
	}
}

func TestProviderValidateRequiresName(t *testing.T) {
	cfg := Default()
	cfg.Name = ""
	if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), "name") {
		t.Fatalf("expected name validation error, got %v", err)
	}
}

func TestProviderValidateInvalidBaseURL(t *testing.T) {
	cfg := Default()
	cfg.BaseURL = "//bad"
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected base_url validation error")
	}
}

func TestProviderListDemo(t *testing.T) {
	got := ListDemo()
	if len(got) == 0 {
		t.Fatal("expected demo provider names")
	}
	if got[0] != "cliproxy" {
		t.Fatalf("unexpected demo provider name: %q", got[0])
	}
}
