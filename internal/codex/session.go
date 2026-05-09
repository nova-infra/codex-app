package codex

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/nova-infra/codex-app/internal/project"
	"github.com/nova-infra/codex-app/internal/provider"
)

// RuntimeBridgePayload mirrors a minimal Codex launch envelope.
type RuntimeBridgePayload struct {
	ProjectName string
	Mode        string
	Provider    string
	Model       string
	CodexHome   string
	DataPath    string
	WorkDir     string
}

type LaunchCommand struct {
	Executable string            `json:"executable"`
	Args       []string          `json:"args"`
	Env        map[string]string `json:"env"`
	WorkDir    string            `json:"work_dir"`
}

// BuildRuntimeBridgePayload maps project/session inputs to a single launch payload.
func BuildRuntimeBridgePayload(p project.Config, providerName string) (RuntimeBridgePayload, error) {
	return buildRuntimeBridgePayload(p, providerName, "")
}

func BuildRuntimeBridgePayloadFromProvider(p project.Config, providerCfg provider.Config) (RuntimeBridgePayload, error) {
	if err := providerCfg.Validate(); err != nil {
		return RuntimeBridgePayload{}, err
	}
	return buildRuntimeBridgePayload(p, providerCfg.Name, providerCfg.Model)
}

func BuildLaunchCommand(p project.Config, providerCfg provider.Config) (LaunchCommand, error) {
	payload, err := BuildRuntimeBridgePayloadFromProvider(p, providerCfg)
	if err != nil {
		return LaunchCommand{}, err
	}
	env := map[string]string{
		"CODEX_HOME":      payload.CodexHome,
		"OPENAI_BASE_URL": providerCfg.BaseURL,
		"OPENAI_MODEL":    providerCfg.Model,
	}
	if providerCfg.APIKey != "" {
		env["OPENAI_API_KEY"] = providerCfg.APIKey
	}
	return LaunchCommand{
		Executable: "codex",
		Args:       []string{"app-server", "--model", providerCfg.Model},
		Env:        env,
		WorkDir:    payload.WorkDir,
	}, nil
}

func buildRuntimeBridgePayload(p project.Config, providerName string, model string) (RuntimeBridgePayload, error) {
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
		Model:       model,
		CodexHome:   codexHome,
		DataPath:    filepath.Join(codexHome, "data"),
		WorkDir:     p.WorkDir,
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
