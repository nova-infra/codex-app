package weixin

import (
	"context"
	"testing"

	"github.com/nova-infra/codex-app/internal/render"
)

func TestWeixinRendererNoToolProgress(t *testing.T) {
	r := NewRenderer()
	events := render.SampleEvents()
	msgs, err := r.Render(context.Background(), render.RenderTarget{ChannelID: "u1", ThreadID: "t1"}, events, render.DefaultProfile(render.ChannelWeixin))
	if err != nil {
		t.Fatalf("render err: %v", err)
	}
	if len(msgs) != 1 {
		t.Fatalf("expect 1 message")
	}
	for _, b := range msgs[0].Blocks {
		if b.Type == "tool_start" || b.Type == "tool_done" || b.Type == "tool_progress" || b.Type == "tool_done:" {
			t.Fatalf("weixin should not expose tool progress: %s", b.Type)
		}
	}
}
