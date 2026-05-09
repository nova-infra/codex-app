package runtime

import "testing"

func TestRunDoctor(t *testing.T) {
	report := RunDoctor()
	if len(report.Checks) == 0 {
		t.Fatal("expected at least one check")
	}
}
