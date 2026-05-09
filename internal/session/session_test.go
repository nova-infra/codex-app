package session

import (
	"path/filepath"
	"testing"

	"github.com/nova-infra/codex-app/internal/project"
)

func TestResolveCodexHomeRequiresExistingDir(t *testing.T) {
	p := project.Config{Name: "default", WorkDir: ".", Agent: "codex", Platforms: []string{"telegram"}, ProviderRefs: []string{"cliproxy"}, CodexHome: "/definitely/does/not/exist"}
	if _, err := ResolveCodexHome(p); err == nil {
		t.Fatal("expected missing codex home error")
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
