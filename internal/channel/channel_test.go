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
