package codex

import (
	"fmt"
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
	codexHome, err := project.NormalizeCodexHome(p)
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
	if p.CodexHome == "" {
		return "", fmt.Errorf("project %q: codex_home is required", p.Name)
	}
	return project.PrepareCodexHome(p)
}
