package session

import (
	"fmt"
	"strings"

	"github.com/nova-infra/codex-app/internal/project"
)

type RuntimeSessionConfig struct {
	ProjectName string `json:"project_name"`
	ProjectHome string `json:"project_home"`
	Mode        string `json:"mode"`
	ProviderRef string `json:"provider_ref"`
}

func DefaultSessionConfig(p project.Config) (RuntimeSessionConfig, error) {
	if err := p.Validate(); err != nil {
		return RuntimeSessionConfig{}, err
	}
	home, err := ResolveCodexHome(p)
	if err != nil {
		return RuntimeSessionConfig{}, err
	}
	provider := ""
	if len(p.ProviderRefs) > 0 {
		provider = p.ProviderRefs[0]
	}
	return RuntimeSessionConfig{
		ProjectName: p.Name,
		ProjectHome: home,
		Mode:        strings.TrimSpace(p.Mode),
		ProviderRef: provider,
	}, nil
}

func ResolveCodexHome(projectCfg project.Config) (string, error) {
	if strings.TrimSpace(projectCfg.CodexHome) == "" {
		return "", fmt.Errorf("project %q: codex_home is required", projectCfg.Name)
	}
	return project.PrepareCodexHome(projectCfg)
}
