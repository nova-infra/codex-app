package render

import "testing"

func TestSampleEvents(t *testing.T) {
	events := SampleEvents()
	if len(events) < 3 {
		t.Fatalf("expected sample events, got %d", len(events))
	}
	if events[len(events)-1].Kind != EventKindFinal {
		t.Fatalf("last event should be final, got %s", events[len(events)-1].Kind)
	}
}

func TestApplyProfileKeepsStructuredApproval(t *testing.T) {
	events := []Event{{
		Kind: EventKindApproval,
		Approval: &ApprovalRequest{
			RequestID: "approval-1",
			Title:     "继续执行",
		},
	}}
	got, _ := ApplyProfile(events, DefaultProfile(ChannelTelegram))
	if len(got) != 1 {
		t.Fatalf("approval event count = %d, want 1", len(got))
	}
	if got[0].Approval == nil || got[0].Approval.RequestID != "approval-1" {
		t.Fatalf("approval = %#v", got[0].Approval)
	}
}
