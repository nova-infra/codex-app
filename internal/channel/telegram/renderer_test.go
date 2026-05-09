package telegram

import (
	"context"
	"testing"

	"github.com/nova-infra/codex-app/internal/render"
)

func TestTelegramRenderer(t *testing.T) {
	r := NewRenderer()
	events := render.SampleEvents()
	msgs, err := r.Render(context.Background(), render.RenderTarget{ChannelID: "u1", ThreadID: "t1"}, events, render.DefaultProfile(render.ChannelTelegram))
	if err != nil {
		t.Fatalf("render err: %v", err)
	}
	if len(msgs) != 1 {
		t.Fatalf("expect 1 message")
	}
	if len(msgs[0].Blocks) < 3 {
		t.Fatalf("expect several blocks, got %d", len(msgs[0].Blocks))
	}
}
