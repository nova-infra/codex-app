package server

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/nova-infra/codex-app/internal/config"
	"github.com/nova-infra/codex-app/internal/runtime"
)

type ServeOptions struct {
	DryRun      bool
	ProjectName string
	ConfigPath  string
}

type ServePlan struct {
	Plan         runtime.StartupPlan
	DryRun       bool
	ConfigSource string
}

func NewServePlan(dryRun bool, projectName string) (ServePlan, error) {
	return NewServePlanWithConfig(dryRun, projectName, "")
}

func NewServePlanWithConfig(dryRun bool, projectName string, configPath string) (ServePlan, error) {
	loaded, err := config.Load(configPath)
	if err != nil {
		return ServePlan{}, err
	}
	plan, err := runtime.BuildStartupPlanFromConfig(loaded.Config, projectName)
	if err != nil {
		return ServePlan{}, err
	}
	plan.DryRun = dryRun
	return ServePlan{Plan: plan, DryRun: dryRun, ConfigSource: loaded.Source}, nil
}

func (s ServePlan) String() string {
	if s.DryRun {
		b, _ := json.MarshalIndent(s.Plan, "", "  ")
		return string(b)
	}
	return runtime.StartupSummary(s.Plan)
}

func Start(options ServeOptions) (string, error) {
	plan, err := NewServePlanWithConfig(options.DryRun, options.ProjectName, options.ConfigPath)
	if err != nil {
		return "", err
	}
	if options.DryRun {
		return plan.String(), nil
	}
	if err := runtime.MissingChannelEnvError(plan.Plan.Channels); err != nil {
		return "", err
	}
	return "", fmt.Errorf("serve non-dry-run is blocked until channel credentials are configured; verified plan: %s", runtime.StartupSummary(plan.Plan))
}

func ensureConfigPaths() (string, string) {
	home := os.Getenv("HOME")
	if home == "" {
		home = "."
	}
	return filepath.Join(home, ".codex-app", "config.json"), filepath.Join(home, ".codex-app")
}

func DoctorJSON() (string, error) {
	cfgPath, dataDir := ensureConfigPaths()
	report := map[string]any{
		"ok": true,
		"data": map[string]any{
			"cwd":        mustGetwd(),
			"configPath": cfgPath,
			"dataDir":    dataDir,
			"goEntry":    "./cmd/codex-app",
		},
		"meta": map[string]any{"command": "doctor"},
	}
	buf, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return "", err
	}
	return string(buf) + "\n", nil
}

func mustGetwd() string {
	cwd, err := os.Getwd()
	if err != nil {
		return ""
	}
	return cwd
}
