package runtime

import (
	"encoding/json"
	"fmt"
	"sort"

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
		Command:       "codex-app serve",
		Mode:          proj.Mode,
		Channels:      channels,
		Services:      services,
		Project:       proj.Name,
		Provider:      providerCfg.Name,
		ProviderModel: providerCfg.Model,
		CodexHome:     codexHome,
		DryRun:        false,
	}, nil
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
