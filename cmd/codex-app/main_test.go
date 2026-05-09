package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/nova-infra/codex-app/internal/channel"
	"github.com/nova-infra/codex-app/internal/render"
)

func TestRunHelp(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"help"}, &out); err != nil {
		t.Fatalf("run help: %v", err)
	}
	for _, want := range []string{"render-demo", "project list", "provider list", "capabilities list"} {
		if !strings.Contains(out.String(), want) {
			t.Fatalf("help missing %s: %s", want, out.String())
		}
	}
}

func TestRunRenderDemo(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"render-demo", "--channel", "all"}, &out); err != nil {
		t.Fatalf("run render-demo: %v", err)
	}
	if !strings.Contains(out.String(), "telegram") || !strings.Contains(out.String(), "lark") {
		t.Fatalf("missing channel output: %s", out.String())
	}
}

func TestRunProjectList(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"project", "list"}, &out); err != nil {
		t.Fatalf("run project list: %v", err)
	}
	if got := strings.TrimSpace(out.String()); got == "" {
		t.Fatalf("expected project list output")
	}
}

func TestRunProviderList(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"provider", "list"}, &out); err != nil {
		t.Fatalf("run provider list: %v", err)
	}
	for _, want := range channel.ListChannels() {
		if !strings.Contains(out.String(), string(want)) {
			t.Fatalf("expected provider %q in output, got %q", want, out.String())
		}
	}
}

func TestRunCapabilitiesList(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"capabilities", "list", "--channel", "all"}, &out); err != nil {
		t.Fatalf("run capabilities list: %v", err)
	}
	for _, want := range []string{
		string(render.CapabilityHTML),
		string(render.CapabilityMarkdown),
		string(render.CapabilityPlainText),
	} {
		if !strings.Contains(out.String(), want) {
			t.Fatalf("expected capabilities output to contain %q, got %q", want, out.String())
		}
	}
}

func TestRunCapabilitiesListJSON(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"capabilities", "list", "--json", "--channel", "all"}, &out); err != nil {
		t.Fatalf("run capabilities list json: %v", err)
	}
	if !strings.Contains(out.String(), "\"ok\": true") || !strings.Contains(out.String(), "plain_text") {
		t.Fatalf("expected json capabilities output, got %q", out.String())
	}
}
