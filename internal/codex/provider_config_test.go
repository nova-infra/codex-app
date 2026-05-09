package codex

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nova-infra/codex-app/internal/project"
	"github.com/nova-infra/codex-app/internal/provider"
)

func TestPlanProviderConfigDoesNotCreateCodexHome(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "codex-home")
	proj := testProject(dir)
	prov := testProvider("secret")
	plan, err := PlanProviderConfig(proj, prov, true)
	if err != nil {
		t.Fatalf("plan provider config: %v", err)
	}
	if !plan.DryRun || !plan.Changed {
		t.Fatalf("unexpected plan: %#v", plan)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("dry-run must not create codex home, stat err=%v", err)
	}
	if plan.Path != filepath.Join(dir, "config.toml") {
		t.Fatalf("unexpected path %q", plan.Path)
	}
}

func TestWriteProviderConfigWritesNoSecretAndBacksUpChanges(t *testing.T) {
	dir := t.TempDir()
	proj := testProject(dir)
	prov := testProvider("secret")
	plan, err := WriteProviderConfig(proj, prov)
	if err != nil {
		t.Fatalf("write provider config: %v", err)
	}
	if !plan.Changed || plan.BackupPath != "" {
		t.Fatalf("unexpected first write plan: %#v", plan)
	}
	body, err := os.ReadFile(filepath.Join(dir, "config.toml"))
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	text := string(body)
	if strings.Contains(text, "secret") {
		t.Fatalf("provider config must not persist API key: %s", text)
	}
	if !strings.Contains(text, "env_key = \"OPENAI_API_KEY\"") {
		t.Fatalf("expected env key contract: %s", text)
	}

	updated := testProvider("secret")
	updated.Model = "gpt-5.5"
	plan, err = WriteProviderConfig(proj, updated)
	if err != nil {
		t.Fatalf("rewrite provider config: %v", err)
	}
	if plan.BackupPath == "" {
		t.Fatalf("expected backup path: %#v", plan)
	}
	if _, err := os.Stat(plan.BackupPath); err != nil {
		t.Fatalf("expected backup file: %v", err)
	}
}

func TestWriteProviderConfigNoopsWhenUnchanged(t *testing.T) {
	dir := t.TempDir()
	proj := testProject(dir)
	prov := testProvider("")
	if _, err := WriteProviderConfig(proj, prov); err != nil {
		t.Fatalf("first write: %v", err)
	}
	plan, err := WriteProviderConfig(proj, prov)
	if err != nil {
		t.Fatalf("second write: %v", err)
	}
	if plan.Changed {
		t.Fatalf("expected unchanged plan: %#v", plan)
	}
}

func TestWriteProviderConfigQuotesProviderName(t *testing.T) {
	dir := t.TempDir()
	proj := testProject(dir)
	proj.ProviderRefs = []string{"cli.proxy"}
	prov := testProvider("")
	prov.Name = "cli.proxy"
	if _, err := WriteProviderConfig(proj, prov); err != nil {
		t.Fatalf("write provider config: %v", err)
	}
	body, err := os.ReadFile(filepath.Join(dir, "config.toml"))
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	if !strings.Contains(string(body), "[model_providers.\"cli.proxy\"]") {
		t.Fatalf("expected quoted provider table, got %s", string(body))
	}
}

func testProject(codexHome string) project.Config {
	return project.Config{
		Name:         "default",
		WorkDir:      ".",
		Agent:        "codex",
		Platforms:    []string{"telegram"},
		ProviderRefs: []string{"cliproxy"},
		CodexHome:    codexHome,
	}
}

func testProvider(apiKey string) provider.Config {
	return provider.Config{
		Name:    "cliproxy",
		Type:    "codex",
		BaseURL: "https://x.empjs.dev/v1",
		Model:   "gpt-5.4-mini",
		APIKey:  apiKey,
	}
}
