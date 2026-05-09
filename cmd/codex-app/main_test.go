package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestRunHelp(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"help"}, &out); err != nil {
		t.Fatalf("run help: %v", err)
	}
	if !strings.Contains(out.String(), "render-demo") {
		t.Fatalf("help missing render-demo: %s", out.String())
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
