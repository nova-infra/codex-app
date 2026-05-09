package server

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/nova-infra/codex-app/internal/config"
	"github.com/nova-infra/codex-app/internal/runtime"
)

type ServeOptions struct {
	DryRun      bool
	ProjectName string
}

type ServePlan struct {
	Plan   runtime.StartupPlan
	DryRun bool
}

func NewServePlan(dryRun bool, projectName string) (ServePlan, error) {
	cfg := config.Default()
	plan, err := runtime.BuildStartupPlanFromConfig(cfg, projectName)
	if err != nil {
		return ServePlan{}, err
	}
	plan.DryRun = dryRun
	return ServePlan{Plan: plan, DryRun: dryRun}, nil
}

func (s ServePlan) String() string {
	if s.DryRun {
		b, _ := json.MarshalIndent(s.Plan, "", "  ")
		return string(b)
	}
	return runtime.StartupSummary(s.Plan)
}

func Start(options ServeOptions) (string, error) {
	plan, err := NewServePlan(options.DryRun, options.ProjectName)
	if err != nil {
		return "", err
	}
	if options.DryRun {
		return plan.String(), nil
	}
	// intentionally keep preview dry-run only: no long polling in this milestone.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	<-ctx.Done()
	return fmt.Sprintf("serve aborted in preview mode: %s", runtime.StartupSummary(plan.Plan)), nil
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
			"cwd":         mustGetwd(),
			"configPath":  cfgPath,
			"dataDir":     dataDir,
			"bunDetected": true,
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
