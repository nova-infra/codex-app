package runtime

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/nova-infra/codex-app/internal/config"
	"github.com/nova-infra/codex-app/internal/render"
)

type CheckStatus string

const (
	CheckOK   CheckStatus = "ok"
	CheckWarn CheckStatus = "warn"
	CheckFail CheckStatus = "fail"
)

type CheckResult struct {
	Name   string      `json:"name"`
	Status CheckStatus `json:"status"`
	Detail string      `json:"detail,omitempty"`
}

type DoctorReport struct {
	Checks []CheckResult `json:"checks"`
}

func (r DoctorReport) Ok() bool {
	for _, check := range r.Checks {
		if check.Status == CheckFail {
			return false
		}
	}
	return true
}

func (r DoctorReport) String() string {
	if len(r.Checks) == 0 {
		return "doctor: no checks"
	}
	parts := make([]string, 0, len(r.Checks))
	for _, check := range r.Checks {
		parts = append(parts, fmt.Sprintf("%s: %s", check.Name, check.Status))
		if check.Detail != "" {
			parts[len(parts)-1] += ": " + check.Detail
		}
	}
	return "doctor:\n" + joinLines(parts)
}

func RunDoctor() DoctorReport {
	loaded, err := config.Load("")
	if err != nil {
		return DoctorReport{Checks: []CheckResult{{Name: "config", Status: CheckFail, Detail: err.Error()}}}
	}
	return RunDoctorWithConfig(loaded.Config, loaded.Source)
}

func RunDoctorWithConfig(cfg config.Config, source string) DoctorReport {
	report := DoctorReport{}

	if _, err := exec.LookPath("go"); err == nil {
		report.Checks = append(report.Checks, CheckResult{Name: "go", Status: CheckOK, Detail: "available"})
	} else {
		report.Checks = append(report.Checks, CheckResult{Name: "go", Status: CheckFail, Detail: "go binary not found"})
	}

	goMod := filepath.Join(".", "go.mod")
	if _, err := os.Stat(goMod); err == nil {
		report.Checks = append(report.Checks, CheckResult{Name: "module", Status: CheckOK, Detail: "go.mod exists"})
	} else {
		report.Checks = append(report.Checks, CheckResult{Name: "module", Status: CheckFail, Detail: "go.mod missing"})
	}

	if err := cfg.Validate(); err != nil {
		report.Checks = append(report.Checks, CheckResult{Name: "config", Status: CheckFail, Detail: err.Error()})
	} else {
		report.Checks = append(report.Checks, CheckResult{Name: "config", Status: CheckOK, Detail: fmt.Sprintf("%s config valid", source)})
	}

	if len(cfg.EnabledChannels) == 0 {
		report.Checks = append(report.Checks, CheckResult{Name: "runtime", Status: CheckFail, Detail: "no enabled channels"})
		return report
	}
	for _, ch := range cfg.EnabledChannels {
		if _, err := render.ParseChannel(ch); err != nil {
			report.Checks = append(report.Checks, CheckResult{Name: "runtime", Status: CheckFail, Detail: err.Error()})
			return report
		}
	}
	report.Checks = append(report.Checks, CheckResult{Name: "runtime", Status: CheckOK, Detail: fmt.Sprintf("%d channels configured", len(cfg.EnabledChannels))})
	report.Checks = append(report.Checks, ChannelCredentialChecks(cfg.EnabledChannels)...)

	return report
}

func joinLines(lines []string) string {
	out := ""
	for i, line := range lines {
		if i > 0 {
			out += "\n"
		}
		out += "- " + line
	}
	return out
}

func ShutdownTimeout() time.Duration {
	return 5 * time.Second
}
