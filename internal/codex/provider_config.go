package codex

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/nova-infra/codex-app/internal/project"
	"github.com/nova-infra/codex-app/internal/provider"
)

type ProviderConfigPlan struct {
	Path          string `json:"path"`
	BackupPath    string `json:"backup_path,omitempty"`
	Provider      string `json:"provider"`
	Model         string `json:"model"`
	BaseURL       string `json:"base_url"`
	APIKeyPresent bool   `json:"api_key_present"`
	Changed       bool   `json:"changed"`
	DryRun        bool   `json:"dry_run"`
}

func PlanProviderConfig(projectCfg project.Config, providerCfg provider.Config, dryRun bool) (ProviderConfigPlan, error) {
	payload, path, err := buildProviderConfig(projectCfg, providerCfg)
	if err != nil {
		return ProviderConfigPlan{}, err
	}
	current, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return ProviderConfigPlan{}, fmt.Errorf("read provider config %q: %w", path, err)
	}
	return ProviderConfigPlan{
		Path:          path,
		Provider:      providerCfg.Name,
		Model:         providerCfg.Model,
		BaseURL:       providerCfg.BaseURL,
		APIKeyPresent: strings.TrimSpace(providerCfg.APIKey) != "",
		Changed:       string(current) != payload,
		DryRun:        dryRun,
	}, nil
}

func WriteProviderConfig(projectCfg project.Config, providerCfg provider.Config) (ProviderConfigPlan, error) {
	payload, path, err := buildProviderConfig(projectCfg, providerCfg)
	if err != nil {
		return ProviderConfigPlan{}, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return ProviderConfigPlan{}, fmt.Errorf("prepare codex home: %w", err)
	}
	plan, err := PlanProviderConfig(projectCfg, providerCfg, false)
	if err != nil {
		return ProviderConfigPlan{}, err
	}
	if !plan.Changed {
		return plan, nil
	}
	if current, err := os.ReadFile(path); err == nil && len(current) > 0 {
		backupPath := backupConfigPath(path, time.Now())
		if err := os.WriteFile(backupPath, current, 0o600); err != nil {
			return ProviderConfigPlan{}, fmt.Errorf("backup provider config %q: %w", path, err)
		}
		plan.BackupPath = backupPath
	} else if err != nil && !os.IsNotExist(err) {
		return ProviderConfigPlan{}, fmt.Errorf("read provider config %q: %w", path, err)
	}
	tmpFile, err := os.CreateTemp(filepath.Dir(path), "config.toml.*.tmp")
	if err != nil {
		return ProviderConfigPlan{}, fmt.Errorf("create temp provider config: %w", err)
	}
	tmp := tmpFile.Name()
	if _, err := tmpFile.WriteString(payload); err != nil {
		_ = tmpFile.Close()
		_ = os.Remove(tmp)
		return ProviderConfigPlan{}, fmt.Errorf("write temp provider config %q: %w", tmp, err)
	}
	if err := tmpFile.Close(); err != nil {
		_ = os.Remove(tmp)
		return ProviderConfigPlan{}, fmt.Errorf("close temp provider config %q: %w", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return ProviderConfigPlan{}, fmt.Errorf("replace provider config %q: %w", path, err)
	}
	return plan, nil
}

func buildProviderConfig(projectCfg project.Config, providerCfg provider.Config) (string, string, error) {
	if err := providerCfg.Validate(); err != nil {
		return "", "", err
	}
	codexHome, err := project.NormalizeCodexHome(projectCfg)
	if err != nil {
		return "", "", err
	}
	payload := renderProviderConfig(providerCfg)
	return payload, filepath.Join(codexHome, "config.toml"), nil
}

func renderProviderConfig(providerCfg provider.Config) string {
	name := tomlString(providerCfg.Name)
	model := tomlString(providerCfg.Model)
	baseURL := tomlString(providerCfg.BaseURL)
	return strings.Join([]string{
		"# Managed by codex-app. Do not store API keys in this file.",
		"model = " + model,
		"model_provider = " + name,
		"",
		"[model_providers." + name + "]",
		"name = " + name,
		"base_url = " + baseURL,
		"env_key = \"OPENAI_API_KEY\"",
		"",
	}, "\n")
}

func tomlString(value string) string {
	escaped := strings.ReplaceAll(value, "\\", "\\\\")
	escaped = strings.ReplaceAll(escaped, "\"", "\\\"")
	return "\"" + escaped + "\""
}

func backupConfigPath(path string, now time.Time) string {
	return fmt.Sprintf("%s.bak.%s", path, now.UTC().Format("20060102T150405.000000000Z"))
}
