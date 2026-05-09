package channel

import (
	"testing"

	"github.com/nova-infra/codex-app/internal/render"
)

func TestRenderDemo(t *testing.T) {
	msgs, err := RenderDemo("telegram")
	if err != nil {
		t.Fatalf("render demo err: %v", err)
	}
	if len(msgs) == 0 {
		t.Fatalf("expect messages")
	}
	if _, err := RenderDemo("unknown"); err == nil {
		t.Fatalf("unknown channel should fail")
	}
	if len(msgs) > 0 {
		if msgs[0].Channel != render.ChannelTelegram {
			t.Fatalf("unexpected channel %s", msgs[0].Channel)
		}
	}
}

func TestListChannels(t *testing.T) {
	channels := ListChannels()
	if len(channels) != 3 {
		t.Fatalf("expect 3 channels, got %d", len(channels))
	}
	want := map[render.Channel]struct{}{
		render.ChannelTelegram: {},
		render.ChannelWeixin:   {},
		render.ChannelLark:     {},
	}
	for _, ch := range channels {
		if _, ok := want[ch]; !ok {
			t.Fatalf("unexpected channel: %s", ch)
		}
	}
}

func TestCapabilitiesForKnownChannels(t *testing.T) {
	for _, ch := range ListChannels() {
		caps, err := Capabilities(string(ch))
		if err != nil {
			t.Fatalf("capabilities error for %s: %v", ch, err)
		}
		if len(caps) == 0 {
			t.Fatalf("expected capabilities for %s", ch)
		}
	}
}

func TestCapabilitiesForAllChannel(t *testing.T) {
	caps, err := Capabilities("all")
	if err != nil {
		t.Fatalf("capabilities(all) error: %v", err)
	}
	if len(caps) < 3 {
		t.Fatalf("expected merged capabilities, got %d", len(caps))
	}
}
