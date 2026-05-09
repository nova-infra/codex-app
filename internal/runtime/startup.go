package runtime

import (
	"fmt"
	"sort"

	"github.com/nova-infra/codex-app/internal/config"
	"github.com/nova-infra/codex-app/internal/render"
)

type StartupPlan struct {
	Command        string                 `json:"command"`
	Mode           string                 `json:"mode"`
	Channels       []string               `json:"channels"`
	Services       []string               `json:"services"`
	Project        string                 `json:"project,omitempty"`
	Provider       string                 `json:"provider,omitempty"`
	ProviderModel  string                 `json:"provider_model,omitempty"`
	CodexHome      string                 `json:"codex_home,omitempty"`
	LaunchCommand  *LaunchPreview         `json:"launch_command,omitempty"`
	ProviderConfig *ProviderConfigPreview `json:"provider_config,omitempty"`
	DryRun         bool                   `json:"dry_run"`
	Addr           string                 `json:"addr"`
}

type LaunchPreview struct {
	Executable string            `json:"executable"`
	Args       []string          `json:"args"`
	Env        map[string]string `json:"env"`
	WorkDir    string            `json:"work_dir"`
}

type ProviderConfigPreview struct {
	Path          string `json:"path"`
	BackupPath    string `json:"backup_path,omitempty"`
	Provider      string `json:"provider"`
	Model         string `json:"model"`
	BaseURL       string `json:"base_url"`
	APIKeyPresent bool   `json:"api_key_present"`
	Changed       bool   `json:"changed"`
	DryRun        bool   `json:"dry_run"`
}

func NewStartupPlan() StartupPlan {
	cfg := config.Default()
	channels := make([]string, len(cfg.EnabledChannels))
	copy(channels, cfg.EnabledChannels)
	sort.Strings(channels)

	services := []string{"codex-session"}
	for _, ch := range channels {
		if _, err := render.ParseChannel(ch); err == nil {
			services = append(services, fmt.Sprintf("%s-adapter", ch))
		}
	}

	return StartupPlan{
		Command:  "codex-app serve",
		Mode:     "dry-run-only",
		Channels: channels,
		Services: services,
		Addr:     "127.0.0.1:8787",
	}
}

func StartupSummary(p StartupPlan) string {
	return fmt.Sprintf("startup plan: command=%s, mode=%s, channels=%v, services=%v, addr=%s", p.Command, p.Mode, p.Channels, p.Services, p.Addr)
}
