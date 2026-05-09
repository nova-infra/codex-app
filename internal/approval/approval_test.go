package approval

import (
	"testing"
	"time"
)

func TestResolveApprovalConfirmRejectAndPending(t *testing.T) {
	now := time.Date(2026, 5, 10, 1, 0, 0, 0, time.UTC)
	req := Request{ID: "req-1", CreatedAt: now}
	for input, want := range map[string]Decision{
		"1":  DecisionConfirm,
		"确认": DecisionConfirm,
		"2":  DecisionReject,
		"拒绝": DecisionReject,
		"":   DecisionPending,
	} {
		got, err := Resolve(req, input, now.Add(time.Minute))
		if err != nil {
			t.Fatalf("resolve %q: %v", input, err)
		}
		if got.Decision != want {
			t.Fatalf("resolve %q = %s, want %s", input, got.Decision, want)
		}
	}
}

func TestResolveApprovalDefaultsTimeoutToExpired(t *testing.T) {
	now := time.Date(2026, 5, 10, 1, 0, 0, 0, time.UTC)
	req := Request{ID: "req-1", CreatedAt: now}
	got, err := Resolve(req, "1", now.Add(DefaultTimeout))
	if err != nil {
		t.Fatalf("resolve expired: %v", err)
	}
	if got.Decision != DecisionExpired {
		t.Fatalf("expected expired, got %s", got.Decision)
	}
}

func TestResolveApprovalRejectsInvalidInput(t *testing.T) {
	now := time.Date(2026, 5, 10, 1, 0, 0, 0, time.UTC)
	_, err := Resolve(Request{ID: "req-1", CreatedAt: now}, "maybe", now)
	if err == nil {
		t.Fatal("expected invalid input error")
	}
}
