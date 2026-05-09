package render

import "testing"

func TestParseChannel(t *testing.T) {
	for _, c := range []string{"telegram", "Weixin", "lark"} {
		if _, err := ParseChannel(c); err != nil {
			t.Fatalf("ParseChannel(%q) error", c)
		}
	}
	if _, err := ParseChannel("unknown"); err == nil {
		t.Fatal("unknown channel should fail")
	}
}

func TestApplyProfileFiltersReasoning(t *testing.T) {
	events := []Event{
		{Kind: EventKindReasoning, Text: "<think>reasoning</think>"},
		{Kind: EventKindTextDelta, Text: "ok"},
	}
	visible, _ := ApplyProfile(events, DefaultProfile(ChannelTelegram))
	if len(visible) != 1 {
		t.Fatalf("expect 1 visible event, got %d", len(visible))
	}
}

func TestSplitPlainText(t *testing.T) {
	parts := splitPlainText("abcdefghijklmnopqrstuvwxyz", 10)
	if len(parts) != 3 {
		t.Fatalf("split count = %d", len(parts))
	}
}
