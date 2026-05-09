package codex

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/nova-infra/codex-app/internal/project"
)

// RuntimeBridgePayload mirrors a minimal Codex launch envelope.
type RuntimeBridgePayload struct {
	ProjectName string
	Mode        string
	Provider    string
	CodexHome   string
	DataPath    string
}

// BuildRuntimeBridgePayload maps project/session inputs to a single launch payload.
func BuildRuntimeBridgePayload(p project.Config, providerName string) (RuntimeBridgePayload, error) {
	if err := p.Validate(); err != nil {
		return RuntimeBridgePayload{}, err
	}
	if providerName == "" {
		return RuntimeBridgePayload{}, fmt.Errorf("provider is required")
	}
	codexHome, err := filepath.Abs(expandTilde(p.CodexHome))
	if err != nil {
		return RuntimeBridgePayload{}, fmt.Errorf("invalid codex home: %w", err)
	}
	return RuntimeBridgePayload{
		ProjectName: p.Name,
		Mode:        p.Mode,
		Provider:    providerName,
		CodexHome:   codexHome,
		DataPath:    filepath.Join(codexHome, "data"),
	}, nil
}

// ResolveProjectCodexHome returns absolute path and ensures directory exists when possible.
func ResolveProjectCodexHome(p project.Config) (string, error) {
	if strings := p.CodexHome; strings == "" {
		return "", fmt.Errorf("project %q: codex_home is required", p.Name)
	}
	abs := expandTilde(p.CodexHome)
	if !filepath.IsAbs(abs) {
		abs = filepath.Clean(filepath.Join(p.WorkDir, abs))
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return "", fmt.Errorf("project %q: cannot prepare codex_home %q: %w", p.Name, abs, err)
	}
	return abs, nil
}

func expandTilde(value string) string {
	if len(value) == 0 {
		return value
	}
	if value[0] != '~' {
		return value
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return value
	}
	if value == "~" {
		return home
	}
	if len(value) > 1 && value[1] == '/' {
		return filepath.Join(home, value[2:])
	}
	return value
}
