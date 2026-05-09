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
	if !hasBlockType(msgs[0].Blocks, "inline_approval") {
		t.Fatalf("sample render should include inline approval: %#v", msgs[0].Blocks)
	}
}

func TestTelegramRendererApprovalMetadata(t *testing.T) {
	r := NewRenderer()
	events := []render.Event{{
		Kind:     render.EventKindApproval,
		ThreadID: "thread-1",
		Approval: &render.ApprovalRequest{
			RequestID: "approval-1",
			Title:     "继续执行",
			Body:      "需要确认",
		},
	}}
	msgs, err := r.Render(context.Background(), render.RenderTarget{ChannelID: "u1"}, events, render.DefaultProfile(render.ChannelTelegram))
	if err != nil {
		t.Fatalf("render err: %v", err)
	}
	block := msgs[0].Blocks[0]
	if block.Type != "inline_approval" {
		t.Fatalf("block type = %q", block.Type)
	}
	if block.Metadata["request_id"] != "approval-1" || block.Metadata["confirm_action"] != "confirm" || block.Metadata["reject_action"] != "reject" {
		t.Fatalf("metadata = %#v", block.Metadata)
	}
}

func hasBlockType(blocks []render.RenderBlock, blockType string) bool {
	for _, block := range blocks {
		if block.Type == blockType {
			return true
		}
	}
	return false
}
