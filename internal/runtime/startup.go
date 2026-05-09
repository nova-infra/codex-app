package runtime

import (
	"fmt"
	"sort"

	"github.com/nova-infra/codex-app/internal/config"
	"github.com/nova-infra/codex-app/internal/render"
)

type StartupPlan struct {
	Command       string   `json:"command"`
	Mode          string   `json:"mode"`
	Channels      []string `json:"channels"`
	Services      []string `json:"services"`
	Project       string   `json:"project,omitempty"`
	Provider      string   `json:"provider,omitempty"`
	ProviderModel string   `json:"provider_model,omitempty"`
	CodexHome     string   `json:"codex_home,omitempty"`
	DryRun        bool     `json:"dry_run"`
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
	}
}

func StartupSummary(p StartupPlan) string {
	return fmt.Sprintf("startup plan: command=%s, mode=%s, channels=%v, services=%v", p.Command, p.Mode, p.Channels, p.Services)
}
