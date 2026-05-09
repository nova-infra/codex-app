package command

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nova-infra/codex-app/internal/config"
	"github.com/nova-infra/codex-app/internal/render"
)

func TestRunUnknownCommand(t *testing.T) {
	var out bytes.Buffer
	r := NewRouter(&out)
	err := r.Run([]string{"does-not-exist"})
	if err == nil || err.Error() == "" {
		t.Fatal("expected unknown command error")
	}
}

func TestRunProjectListRequiresSubcommand(t *testing.T) {
	var out bytes.Buffer
	r := NewRouter(&out)
	err := r.Run([]string{"project"})
	if err == nil {
		t.Fatal("expected project usage error")
	}
}

func TestRunSupportsCustomProjectList(t *testing.T) {
	var out bytes.Buffer
	r := NewRouter(&out, WithListProjects(func() ([]string, error) {
		return []string{"alpha", "beta"}, nil
	}))
	if err := r.Run([]string{"project", "list"}); err != nil {
		t.Fatalf("run project list: %v", err)
	}
	text := out.String()
	if !strings.Contains(text, "alpha") || !strings.Contains(text, "beta") {
		t.Fatalf("expected custom project list, got %q", text)
	}
}

func TestRunSupportsCustomProviders(t *testing.T) {
	var out bytes.Buffer
	r := NewRouter(&out, WithListProviders(func() ([]string, error) {
		return []string{"custom-provider"}, nil
	}))
	if err := r.Run([]string{"provider", "list"}); err != nil {
		t.Fatalf("run provider list: %v", err)
	}
	if got := out.String(); !strings.Contains(got, "custom-provider") {
		t.Fatalf("expected custom provider, got %q", got)
	}
}

func TestRunCapabilitiesForChannel(t *testing.T) {
	var out bytes.Buffer
	r := NewRouter(&out, WithListCapabilities(func(name string) ([]string, error) {
		if name == string(render.ChannelTelegram) {
			return []string{"notify", "reply"}, nil
		}
		if name == "unknown" {
			return nil, errors.New("not found")
		}
		return []string{}, nil
	}))
	if err := r.Run([]string{"capabilities", "list", "--channel", string(render.ChannelTelegram)}); err != nil {
		t.Fatalf("run capabilities list: %v", err)
	}
	for _, item := range []string{"notify", "reply"} {
		if !strings.Contains(out.String(), item) {
			t.Fatalf("expected capability %q, got %q", item, out.String())
		}
	}
}

func TestRunCapabilitiesListJSON(t *testing.T) {
	var out bytes.Buffer
	r := NewRouter(&out, WithListCapabilities(func(name string) ([]string, error) {
		return []string{"alpha"}, nil
	}))
	if err := r.Run([]string{"capabilities", "list", "--json", "--channel", "all"}); err != nil {
		t.Fatalf("run capabilities list json: %v", err)
	}
	got := out.String()
	if !strings.Contains(got, "\"ok\": true") || !strings.Contains(got, "alpha") {
		t.Fatalf("expected json capabilities output, got %q", got)
	}
}

func TestRunDoctor(t *testing.T) {
	var out bytes.Buffer
	r := NewRouter(&out)
	if err := r.Run([]string{"doctor"}); err != nil {
		t.Fatalf("run doctor: %v", err)
	}
	got := out.String()
	if !strings.Contains(got, "go:") && !strings.Contains(got, "doctor:") {
		t.Fatalf("unexpected doctor output: %q", got)
	}
}

func TestRunDoctorJSON(t *testing.T) {
	var out bytes.Buffer
	r := NewRouter(&out)
	if err := r.Run([]string{"doctor", "--json"}); err != nil {
		t.Fatalf("run doctor json: %v", err)
	}
	if !strings.Contains(out.String(), "\"ok\": true") && !strings.Contains(out.String(), "\"ok\": false") {
		t.Fatalf("doctor json output invalid: %q", out.String())
	}
}

func TestRunDoctorWithConfig(t *testing.T) {
	path := writeTestConfig(t, "custom")
	var out bytes.Buffer
	r := NewRouter(&out)
	if err := r.Run([]string{"doctor", "--config", path}); err != nil {
		t.Fatalf("run doctor config: %v", err)
	}
	if !strings.Contains(out.String(), path) {
		t.Fatalf("expected config path in doctor output, got %q", out.String())
	}
}

func TestRunServeDryRunJSON(t *testing.T) {
	var out bytes.Buffer
	r := NewRouter(&out)
	if err := r.Run([]string{"serve", "--dry-run", "--json"}); err != nil {
		t.Fatalf("run serve dry-run: %v", err)
	}
	got := out.String()
	if !strings.Contains(got, "\"dry_run\": true") {
		t.Fatalf("expect dry_run true in output: %q", got)
	}
}

func TestRunServeDryRunWithConfig(t *testing.T) {
	path := writeTestConfig(t, "custom")
	var out bytes.Buffer
	r := NewRouter(&out)
	if err := r.Run([]string{"serve", "--dry-run", "--config", path}); err != nil {
		t.Fatalf("run serve config: %v", err)
	}
	if !strings.Contains(out.String(), "\"project\": \"custom\"") {
		t.Fatalf("expected custom project, got %q", out.String())
	}
}

func TestRunProviderListError(t *testing.T) {
	var out bytes.Buffer
	r := NewRouter(&out, WithListProviders(func() ([]string, error) {
		return nil, errors.New("boom")
	}))
	if err := r.Run([]string{"provider", "list"}); err == nil || !strings.Contains(err.Error(), "boom") {
		t.Fatalf("expected provider list error, got %v", err)
	}
}

func TestParseJSONCommand(t *testing.T) {
	jsonRequested, args := parseJSONCommand([]string{"--json", "render-demo", "--channel", "all"})
	if !jsonRequested {
		t.Fatal("expected jsonRequested=true")
	}
	want := []string{"render-demo", "--channel", "all"}
	if len(args) != len(want) {
		t.Fatalf("args len=%d want=%d", len(args), len(want))
	}
	for i := range want {
		if args[i] != want[i] {
			t.Fatalf("args[%d]=%q want=%q", i, args[i], want[i])
		}
	}
}

func writeTestConfig(t *testing.T, projectName string) string {
	t.Helper()
	cfg := config.Default()
	cfg.Projects[0].Name = projectName
	body, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, body, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}
