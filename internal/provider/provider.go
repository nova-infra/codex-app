package provider

import (
	"fmt"
	"net/url"
	"sort"
	"strings"
)

// Config represents one provider in the lightweight Go rewrite config model.
type Config struct {
	Name    string `json:"name" toml:"name"`
	Type    string `json:"type" toml:"type"`
	BaseURL string `json:"base_url" toml:"base_url"`
	Model   string `json:"model" toml:"model"`
	APIKey  string `json:"api_key" toml:"api_key"`
}

// Default returns a minimal built-in provider used in demo list output.
func Default() Config {
	return Config{
		Name:    "cliproxy",
		Type:    "codex",
		BaseURL: "https://x.empjs.dev/v1",
		Model:   "gpt-5.4-mini",
		APIKey:  "",
	}
}

// Demo returns demo provider entries for command output.
func Demo() []Config {
	return []Config{Default()}
}

// ListDemo returns provider names in stable order.
func ListDemo() []string {
	providers := Demo()
	names := make([]string, 0, len(providers))
	for _, p := range providers {
		names = append(names, p.Name)
	}
	sort.Strings(names)
	return names
}

// Validate checks provider configuration constraints.
func (c Config) Validate() error {
	if strings.TrimSpace(c.Name) == "" {
		return fmt.Errorf("provider name is required")
	}
	if strings.TrimSpace(c.Type) == "" {
		return fmt.Errorf("provider %q: type is required", c.Name)
	}
	if strings.TrimSpace(c.BaseURL) == "" {
		return fmt.Errorf("provider %q: base_url is required", c.Name)
	}
	parsed, err := url.Parse(c.BaseURL)
	if err != nil {
		return fmt.Errorf("provider %q: invalid base_url: %w", c.Name, err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("provider %q: invalid base_url %q", c.Name, c.BaseURL)
	}
	if strings.TrimSpace(c.Model) == "" {
		return fmt.Errorf("provider %q: model is required", c.Name)
	}
	return nil
}

// ResolveProvider returns a provider by name.
func ResolveProvider(providers []Config, name string) (Config, error) {
	if len(providers) == 0 {
		return Config{}, fmt.Errorf("providers are required")
	}
	for _, provider := range providers {
		if provider.Name == name {
			return provider, nil
		}
	}
	return Config{}, fmt.Errorf("provider %q not found", name)
}
