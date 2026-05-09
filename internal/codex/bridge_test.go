package codex

import (
	"path/filepath"
	"testing"

	"github.com/nova-infra/codex-app/internal/project"
	"github.com/nova-infra/codex-app/internal/provider"
)

func TestNewSessionRequiresProviderValidation(t *testing.T) {
	p := project.Default()
	bad := provider.Default()
	bad.BaseURL = ""
	if _, err := NewSession(p, bad); err == nil {
		t.Fatal("expected validation error")
	}
}

func TestNewSessionBuildsRuntimeConfig(t *testing.T) {
	tmp := t.TempDir()
	p := project.Default()
	p.CodexHome = tmp
	pr := provider.Default()
	s, err := NewSession(p, pr)
	if err != nil {
		t.Fatalf("new session: %v", err)
	}
	if !s.Initialized {
		t.Fatal("session not initialized")
	}
	if s.Runtime.ProjectHome != filepath.Clean(tmp) {
		t.Fatalf("unexpected project home: %q", s.Runtime.ProjectHome)
	}
}
