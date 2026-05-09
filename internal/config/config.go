package config

import (
	"fmt"
	"sort"
	"strings"

	"github.com/nova-infra/codex-app/internal/project"
	"github.com/nova-infra/codex-app/internal/provider"
)

// Config represents a compact runtime configuration for the Go preview rewrite.
type Config struct {
	// Runtime fields retained for existing call sites in milestone-1 code.
	DefaultChannel  string   `json:"default_channel" toml:"default_channel"`
	EnabledChannels []string `json:"enabled_channels" toml:"enabled_channels"`

	DataDir   string            `json:"data_dir" toml:"data_dir"`
	Language  string            `json:"language" toml:"language"`
	Providers []provider.Config `json:"providers" toml:"providers"`
	Projects  []project.Config  `json:"projects" toml:"projects"`
}

// RuntimeConfig contains the small amount of runtime state needed by the
// preview command surface.
type RuntimeConfig struct {
	DefaultChannel  string
	EnabledChannels []string
}

// Default returns the current small runtime baseline used by render-demo.
func DefaultRuntime() RuntimeConfig {
	return RuntimeConfig{
		DefaultChannel:  "all",
		EnabledChannels: []string{"telegram", "wechat", "lark"},
	}
}

// Default returns a compact config shape matching phase-2 Go rewrite goals.
func Default() Config {
	return Config{
		DefaultChannel:  "all",
		EnabledChannels: []string{"telegram", "wechat", "lark"},
		DataDir:         "~/.codex-app",
		Language:        "zh",
		Providers:       provider.Demo(),
		Projects:        project.Demo(),
	}
}

// ListDemoProjects returns demo project names.
func ListDemoProjects() []string {
	return project.ListDemo()
}

// ListDemoProviders returns demo provider names.
func ListDemoProviders() []string {
	return provider.ListDemo()
}

func (c Config) RuntimeProject(projectName string) string {
	if strings.TrimSpace(projectName) != "" {
		return strings.TrimSpace(projectName)
	}
	return "default"
}

// Validate checks top-level config plus nested provider/project entries.
func (c Config) Validate() error {
	if strings.TrimSpace(c.DataDir) == "" {
		return fmt.Errorf("data_dir is required")
	}
	if strings.TrimSpace(c.Language) == "" {
		return fmt.Errorf("language is required")
	}
	if len(c.Providers) == 0 {
		return fmt.Errorf("providers is required")
	}
	if len(c.Projects) == 0 {
		return fmt.Errorf("projects is required")
	}

	providerName := map[string]struct{}{}
	for i, p := range c.Providers {
		if err := p.Validate(); err != nil {
			return fmt.Errorf("providers[%d]: %w", i, err)
		}
		if _, exists := providerName[p.Name]; exists {
			return fmt.Errorf("providers[%d]: duplicate provider name %q", i, p.Name)
		}
		providerName[p.Name] = struct{}{}
	}

	projectNames := map[string]struct{}{}
	projectSet := make([]string, 0, len(c.Projects))
	for i, p := range c.Projects {
		if err := p.Validate(); err != nil {
			return fmt.Errorf("projects[%d]: %w", i, err)
		}
		if _, exists := projectNames[p.Name]; exists {
			return fmt.Errorf("projects[%d]: duplicate project name %q", i, p.Name)
		}
		projectNames[p.Name] = struct{}{}
		projectSet = append(projectSet, p.Name)

		for _, ref := range p.ProviderRefs {
			if _, exists := providerName[ref]; !exists {
				return fmt.Errorf("projects[%d]: project %q references unknown provider %q", i, p.Name, ref)
			}
		}
	}

	sort.Strings(projectSet)
	if len(projectSet) != len(c.Projects) {
		// kept for defensive parity with historical duplicate checks above.
		return fmt.Errorf("projects contain inconsistent duplicates")
	}

	return nil
}
