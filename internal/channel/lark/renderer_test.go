package lark

import (
	"context"
	"testing"

	"github.com/nova-infra/codex-app/internal/render"
)

func TestLarkRendererDedupeTools(t *testing.T) {
	r := NewRenderer()
	events := []render.Event{
		{Kind: render.EventKindToolStart, ToolName: "build"},
		{Kind: render.EventKindToolStart, ToolName: "build"},
		{Kind: render.EventKindFinal, Text: "ok"},
	}
	msgs, err := r.Render(context.Background(), render.RenderTarget{ChannelID: "u1", ThreadID: "t1"}, events, render.DefaultProfile(render.ChannelLark))
	if err != nil {
		t.Fatalf("render err: %v", err)
	}
	count := 0
	for _, b := range msgs[0].Blocks {
		if b.Type == "card_stage" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("expected deduped tool stage count=1, got %d", count)
	}
}

func TestLarkRendererApprovalCard(t *testing.T) {
	r := NewRenderer()
	events := []render.Event{{
		Kind: render.EventKindApproval,
		Approval: &render.ApprovalRequest{
			RequestID: "approval-1",
			Title:     "继续执行",
			Body:      "需要确认",
		},
	}}
	msgs, err := r.Render(context.Background(), render.RenderTarget{ChannelID: "u1", ThreadID: "t1"}, events, render.DefaultProfile(render.ChannelLark))
	if err != nil {
		t.Fatalf("render err: %v", err)
	}
	block := msgs[0].Blocks[0]
	if block.Type != "card_approval" {
		t.Fatalf("block type = %q", block.Type)
	}
	if block.Metadata["request_id"] != "approval-1" || block.Metadata["confirm_action"] != "confirm" || block.Metadata["reject_action"] != "reject" {
		t.Fatalf("metadata = %#v", block.Metadata)
	}
}
