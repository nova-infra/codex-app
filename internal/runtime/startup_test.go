package runtime

import (
	"strings"
	"testing"
)

func TestNewStartupPlanContainsServices(t *testing.T) {
	plan := NewStartupPlan()
	if plan.Command == "" {
		t.Fatal("expected plan command")
	}
	if len(plan.Channels) == 0 {
		t.Fatal("expected channels")
	}
	if !strings.Contains(plan.Mode, "dry-run") {
		t.Fatalf("expected dry-run mode, got %q", plan.Mode)
	}
}
