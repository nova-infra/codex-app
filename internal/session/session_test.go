package session

import (
	"path/filepath"
	"testing"

	"github.com/nova-infra/codex-app/internal/project"
)

func TestResolveCodexHomePreparesDir(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "codex-home")
	p := project.Config{Name: "default", WorkDir: ".", Agent: "codex", Platforms: []string{"telegram"}, ProviderRefs: []string{"cliproxy"}, CodexHome: dir}
	got, err := ResolveCodexHome(p)
	if err != nil {
		t.Fatalf("resolve codex home: %v", err)
	}
	if got != dir {
		t.Fatalf("expected codex home %q, got %q", dir, got)
	}
}

func TestDefaultSessionConfigUsesFirstProvider(t *testing.T) {
	dir := t.TempDir()
	p := project.Config{Name: "default", WorkDir: ".", Agent: "codex", Platforms: []string{"telegram"}, ProviderRefs: []string{"cliproxy", "other"}, CodexHome: dir, Mode: "yolo"}
	cfg, err := DefaultSessionConfig(p)
	if err != nil {
		t.Fatalf("default session config: %v", err)
	}
	if cfg.ProviderRef != "cliproxy" {
		t.Fatalf("expected first provider ref, got %q", cfg.ProviderRef)
	}
	if cfg.ProjectHome != dir {
		t.Fatalf("expected project home %q, got %q", dir, cfg.ProjectHome)
	}
	_ = filepath.Base(cfg.ProjectName)
}
