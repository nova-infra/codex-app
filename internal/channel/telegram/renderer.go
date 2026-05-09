package telegram

import (
	"context"

	"github.com/nova-infra/codex-app/internal/render"
)

type Renderer struct{}

func NewRenderer() *Renderer { return &Renderer{} }

func (r *Renderer) Render(_ context.Context, target render.RenderTarget, events []render.Event, profile render.DisplayProfile) ([]render.PlatformMessage, error) {
	normalized, warnings := render.ApplyProfile(events, profile)
	message := render.PlatformMessage{Channel: render.ChannelTelegram, Target: target, Profile: profile, Warnings: warnings}
	for _, event := range normalized {
		if event.Kind == render.EventKindApproval {
			message.Blocks = append(message.Blocks, render.RenderBlock{
				Type:     "inline_approval",
				Text:     formatApproval(event),
				Metadata: approvalMetadata(event, map[string]string{"kind": "approval", "confirm_action": "confirm", "reject_action": "reject"}),
			})
			continue
		}
		if event.Kind == render.EventKindToolStart || event.Kind == render.EventKindToolDone {
			if event.Text == "" && event.ToolName != "" {
				event.Text = event.ToolName
			}
			message.Blocks = append(message.Blocks, render.RenderBlock{
				Type:     render.BlockType(event.Kind),
				Text:     event.Text,
				Metadata: map[string]string{"tool": event.ToolName},
				Media:    nil,
			})
			continue
		}
		if event.Kind == render.EventKindFinal {
			if profile.Streaming && profile.MessageUpdate {
				message.Blocks = append(message.Blocks, render.BuildTextBlocks(event.Text, profile.ToolPreviewLength)...)
				continue
			}
		}
		message.Blocks = append(message.Blocks, render.RenderBlock{Type: render.BlockType(event.Kind), Text: event.Text, Media: event.Media, Metadata: map[string]string{"thread": event.ThreadID}})
	}
	if len(message.Blocks) == 0 {
		return nil, nil
	}
	return []render.PlatformMessage{message}, nil
}

func formatApproval(event render.Event) string {
	if event.Approval == nil {
		return event.Text
	}
	text := event.Approval.Title
	if event.Approval.Body != "" {
		text += "\n" + event.Approval.Body
	}
	return text
}

func approvalMetadata(event render.Event, metadata map[string]string) map[string]string {
	if event.Approval != nil {
		metadata["request_id"] = event.Approval.RequestID
	}
	if event.ThreadID != "" {
		metadata["thread"] = event.ThreadID
	}
	return metadata
}
