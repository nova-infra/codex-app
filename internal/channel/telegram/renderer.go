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
	blocks := []render.RenderBlock{}
	for _, event := range normalized {
		if event.Kind == render.EventKindToolStart || event.Kind == render.EventKindToolDone {
			if event.Text == "" && event.ToolName != "" {
				event.Text = event.ToolName
			}
			blocks = append(blocks, render.RenderBlock{
				Type:     render.BlockType(event.Kind),
				Text:     event.Text,
				Metadata: map[string]string{"tool": event.ToolName},
				Media:    nil,
			})
			continue
		}
		if event.Kind == render.EventKindFinal {
			if profile.Streaming && profile.MessageUpdate {
				blocks = append(blocks, render.BuildTextBlocks(event.Text, profile.ToolPreviewLength)...)
				continue
			}
		}
		blocks = append(blocks, render.RenderBlock{Type: render.BlockType(event.Kind), Text: event.Text, Media: event.Media, Metadata: map[string]string{"thread": event.ThreadID}})
	}
	if len(blocks) > 0 {
		message.Blocks = blocks
	}
	if len(message.Blocks) == 0 {
		return nil, nil
	}
	return []render.PlatformMessage{message}, nil
}
