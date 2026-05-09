package server

import (
	"testing"
)

func TestStartDryRunReturnsPlan(t *testing.T) {
	out, err := Start(ServeOptions{DryRun: true})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if out == "" {
		t.Fatal("expected output")
	}
}

func TestStartLiveReturnsPlan(t *testing.T) {
	out, err := Start(ServeOptions{DryRun: false})
	if err == nil {
		t.Fatal("expected non-dry-run preview blocker")
	}
	if out != "" {
		t.Fatalf("expected no output on blocked start, got %q", out)
	}
}
