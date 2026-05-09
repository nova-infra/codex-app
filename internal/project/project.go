package project

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"github.com/nova-infra/codex-app/internal/render"
)

// Config represents one project in the lightweight Go rewrite config model.
type Config struct {
	Name         string   `json:"name" toml:"name"`
	WorkDir      string   `json:"work_dir" toml:"work_dir"`
	Agent        string   `json:"agent" toml:"agent"`
	Platforms    []string `json:"platforms" toml:"platforms"`
	ProviderRefs []string `json:"provider_refs" toml:"provider_refs"`
	CodexHome    string   `json:"codex_home" toml:"codex_home"`
	Mode         string   `json:"mode" toml:"mode"`
}

// Default returns a minimal safe default project used by list/demo commands.
func Default() Config {
	return Config{
		Name:         "default",
		WorkDir:      ".",
		Agent:        "codex",
		Platforms:    []string{string(render.ChannelTelegram), string(render.ChannelWeixin), string(render.ChannelLark)},
		ProviderRefs: []string{"cliproxy"},
		CodexHome:    "~/.codex-app/codex-home",
		Mode:         "yolo",
	}
}

// Demo returns demo configuration entries for project list output in the preview CLI.
func Demo() []Config {
	return []Config{Default()}
}

// ListDemo returns project names that should be shown by command defaults.
func ListDemo() []string {
	demos := Demo()
	names := make([]string, 0, len(demos))
	for _, p := range demos {
		names = append(names, p.Name)
	}
	sort.Strings(names)
	return names
}

// Validate checks project configuration constraints.
func (c Config) Validate() error {
	if strings.TrimSpace(c.Name) == "" {
		return fmt.Errorf("project name is required")
	}
	if strings.TrimSpace(c.WorkDir) == "" {
		return fmt.Errorf("project %q: work_dir is required", c.Name)
	}
	if strings.TrimSpace(c.Agent) == "" {
		return fmt.Errorf("project %q: agent is required", c.Name)
	}
	if len(c.Platforms) == 0 {
		return fmt.Errorf("project %q: platforms is required", c.Name)
	}
	seenPlatforms := map[string]struct{}{}
	for _, p := range c.Platforms {
		name := strings.TrimSpace(strings.ToLower(p))
		if name == "" {
			return fmt.Errorf("project %q: platform cannot be blank", c.Name)
		}
		if _, err := render.ParseChannel(name); err != nil {
			return fmt.Errorf("project %q: %w", c.Name, err)
		}
		if _, exists := seenPlatforms[name]; exists {
			return fmt.Errorf("project %q: duplicate platform %q", c.Name, name)
		}
		seenPlatforms[name] = struct{}{}
	}
	if len(c.ProviderRefs) == 0 {
		return fmt.Errorf("project %q: provider_refs is required", c.Name)
	}
	seenRefs := map[string]struct{}{}
	for _, ref := range c.ProviderRefs {
		if strings.TrimSpace(ref) == "" {
			return fmt.Errorf("project %q: provider_ref cannot be blank", c.Name)
		}
		if _, exists := seenRefs[ref]; exists {
			return fmt.Errorf("project %q: duplicate provider_ref %q", c.Name, ref)
		}
		seenRefs[ref] = struct{}{}
	}
	if strings.TrimSpace(c.CodexHome) == "" {
		return fmt.Errorf("project %q: codex_home is required", c.Name)
	}
	if err := c.ValidateCodexHome(); err != nil {
		return err
	}
	return nil
}

// ValidateCodexHome checks project-local CODEX_HOME is syntactically valid.
func (c Config) ValidateCodexHome() error {
	if strings.TrimSpace(c.CodexHome) == "" {
		return fmt.Errorf("project %q: codex_home is required", c.Name)
	}
	if filepath.Clean(c.CodexHome) == "." {
		return fmt.Errorf("project %q: codex_home must be explicit", c.Name)
	}
	return nil
}

// ResolveProject returns the named project. If empty, it returns the first project.
func ResolveProject(projects []Config, name string) (Config, error) {
	if len(projects) == 0 {
		return Config{}, fmt.Errorf("projects are required")
	}
	if name == "" {
		return projects[0], nil
	}
	for _, project := range projects {
		if project.Name == name {
			return project, nil
		}
	}
	return Config{}, fmt.Errorf("project %q not found", name)
}
