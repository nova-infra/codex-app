package session

import (
	"fmt"
	"os"
	"path/filepath"
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
	home := expandPath(projectCfg.CodexHome)
	if err := isDirectory(home); err != nil {
		return "", err
	}
	return home, nil
}

func isDirectory(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("codex home not exists: %s", path)
		}
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("codex home is not a directory: %s", path)
	}
	return nil
}

func expandPath(path string) string {
	if strings.HasPrefix(path, "~") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, path[1:])
		}
	}
	return path
}
