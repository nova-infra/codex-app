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

func TestWeixinRendererApprovalMenu(t *testing.T) {
	r := NewRenderer()
	events := []render.Event{{
		Kind: render.EventKindApproval,
		Approval: &render.ApprovalRequest{
			RequestID: "approval-1",
			Title:     "继续执行",
			Body:      "需要确认",
		},
	}}
	msgs, err := r.Render(context.Background(), render.RenderTarget{ChannelID: "u1"}, events, render.DefaultProfile(render.ChannelWeixin))
	if err != nil {
		t.Fatalf("render err: %v", err)
	}
	block := msgs[0].Blocks[0]
	if block.Type != "approval_menu" {
		t.Fatalf("block type = %q", block.Type)
	}
	if block.Metadata["request_id"] != "approval-1" || block.Metadata["confirm_input"] != "1" || block.Metadata["reject_input"] != "2" {
		t.Fatalf("metadata = %#v", block.Metadata)
	}
	if block.Text == "" {
		t.Fatal("expected approval menu text")
	}
}
