package runtime

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/nova-infra/codex-app/internal/codex"
	"github.com/nova-infra/codex-app/internal/config"
	"github.com/nova-infra/codex-app/internal/project"
	"github.com/nova-infra/codex-app/internal/provider"
)

// BuildStartupPlanFromConfig resolves a project + provider pair and returns a startup plan preview.
func BuildStartupPlanFromConfig(cfg config.Config, projectName string) (StartupPlan, error) {
	if err := cfg.Validate(); err != nil {
		return StartupPlan{}, fmt.Errorf("config invalid: %w", err)
	}
	proj, err := project.ResolveProject(cfg.Projects, projectName)
	if err != nil {
		return StartupPlan{}, err
	}
	providerCfg, err := provider.ResolveProvider(cfg.Providers, proj.ProviderRefs[0])
	if err != nil {
		return StartupPlan{}, err
	}
	launchCommand, err := codex.BuildLaunchCommand(proj, providerCfg)
	if err != nil {
		return StartupPlan{}, err
	}
	providerConfigPlan, err := codex.PlanProviderConfig(proj, providerCfg, true)
	if err != nil {
		return StartupPlan{}, err
	}
	codexHome, err := project.NormalizeCodexHome(proj)
	if err != nil {
		return StartupPlan{}, err
	}
	channels := append([]string(nil), proj.Platforms...)
	sort.Strings(channels)
	services := []string{"codex-session"}
	for _, ch := range channels {
		services = append(services, fmt.Sprintf("%s-adapter", ch))
	}
	return StartupPlan{
		Command:        "codex-app serve",
		Mode:           proj.Mode,
		Channels:       channels,
		Services:       services,
		Project:        proj.Name,
		Provider:       providerCfg.Name,
		ProviderModel:  providerCfg.Model,
		CodexHome:      codexHome,
		LaunchCommand:  NewLaunchPreview(launchCommand),
		ProviderConfig: NewProviderConfigPreview(providerConfigPlan),
		DryRun:         false,
		Addr:           "127.0.0.1:8787",
	}, nil
}

func NewLaunchPreview(command codex.LaunchCommand) *LaunchPreview {
	env := make(map[string]string, len(command.Env))
	for key, value := range command.Env {
		env[key] = redactEnvValue(key, value)
	}
	return &LaunchPreview{
		Executable: command.Executable,
		Args:       append([]string(nil), command.Args...),
		Env:        env,
		WorkDir:    command.WorkDir,
	}
}

func NewProviderConfigPreview(plan codex.ProviderConfigPlan) *ProviderConfigPreview {
	return &ProviderConfigPreview{
		Path:          plan.Path,
		BackupPath:    plan.BackupPath,
		Provider:      plan.Provider,
		Model:         plan.Model,
		BaseURL:       plan.BaseURL,
		APIKeyPresent: plan.APIKeyPresent,
		Changed:       plan.Changed,
		DryRun:        plan.DryRun,
	}
}

func redactEnvValue(key string, value string) string {
	if strings.TrimSpace(value) == "" {
		return value
	}
	upper := strings.ToUpper(key)
	for _, marker := range []string{"KEY", "TOKEN", "SECRET", "PASSWORD"} {
		if strings.Contains(upper, marker) {
			return "<redacted>"
		}
	}
	return value
}

// BuildStartupPlan keeps compatibility with older call sites.
func BuildStartupPlan(cfg config.Config, projectName string) (StartupPlan, error) {
	return BuildStartupPlanFromConfig(cfg, projectName)
}

// ResolveAndValidateProjectCodexHome checks a project-specific CODEX_HOME string.
func ResolveAndValidateProjectCodexHome(p project.Config) (string, error) {
	return project.NormalizeCodexHome(p)
}

// ResolveAndValidateProvider wraps project-provider resolution for compatibility.
func ResolveAndValidateProvider(cfg []provider.Config, ref string) (provider.Config, error) {
	return provider.ResolveProvider(cfg, ref)
}

// EmitDoctorJSON renders a lightweight JSON snapshot of doctor checks.
func EmitDoctorJSON(result DoctorReport) (string, error) {
	payload := map[string]any{
		"ok":   result.Ok(),
		"data": result.Checks,
		"meta": map[string]string{
			"command": "doctor",
		},
	}
	b, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return "", err
	}
	return string(b) + "\n", nil
}
