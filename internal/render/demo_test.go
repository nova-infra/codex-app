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
