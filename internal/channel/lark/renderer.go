package lark

import (
	"context"

	"github.com/nova-infra/codex-app/internal/render"
)

type Renderer struct{}

func NewRenderer() *Renderer { return &Renderer{} }

func (r *Renderer) Render(_ context.Context, target render.RenderTarget, events []render.Event, profile render.DisplayProfile) ([]render.PlatformMessage, error) {
	normalized, warnings := render.ApplyProfile(events, profile)
	message := render.PlatformMessage{Channel: render.ChannelLark, Target: target, Profile: profile, Warnings: warnings}
	seenTools := map[string]bool{}
	for _, event := range normalized {
		switch event.Kind {
		case render.EventKindToolStart, render.EventKindToolDone:
			if event.ToolName == "" {
				continue
			}
			if seenTools[event.ToolName] {
				continue
			}
			seenTools[event.ToolName] = true
			message.Blocks = append(message.Blocks, render.RenderBlock{Type: "card_stage", Text: event.ToolName, Metadata: map[string]string{"kind": "tool"}})
			continue
		case render.EventKindApproval:
			requestID := ""
			if event.Approval != nil {
				requestID = event.Approval.RequestID
			}
			message.Blocks = append(message.Blocks, render.RenderBlock{
				Type:     "card_approval",
				Text:     event.Text,
				Metadata: map[string]string{"kind": "approval", "request_id": requestID},
			})
		default:
			message.Blocks = append(message.Blocks, render.RenderBlock{Type: render.BlockType(event.Kind), Text: event.Text, Metadata: map[string]string{"card": "true"}})
		}
	}
	if len(message.Blocks) == 0 {
		return nil, nil
	}
	return []render.PlatformMessage{message}, nil
}
