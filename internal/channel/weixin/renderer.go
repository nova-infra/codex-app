package weixin

import (
	"context"

	"github.com/nova-infra/codex-app/internal/render"
)

type Renderer struct{}

func NewRenderer() *Renderer { return &Renderer{} }

func (r *Renderer) Render(_ context.Context, target render.RenderTarget, events []render.Event, profile render.DisplayProfile) ([]render.PlatformMessage, error) {
	normalized, warnings := render.ApplyProfile(events, profile)
	message := render.PlatformMessage{Channel: render.ChannelWeixin, Target: target, Profile: profile, Warnings: warnings}
	for _, event := range normalized {
		if event.Kind == render.EventKindApproval || event.Kind == render.EventKindMedia {
			message.Blocks = append(message.Blocks, render.BuildTextBlocks(formatApproval(event), profile.ToolPreviewLength)...)
			continue
		}
		message.Blocks = append(message.Blocks, render.RenderBlock{Type: render.BlockType(event.Kind), Text: event.Text, Metadata: map[string]string{}})
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
	line := "[approval] " + event.Approval.Title
	if event.Approval.Body != "" {
		line += "：" + event.Approval.Body
	}
	line += "\n回复 1 确认，2 拒绝"
	return line
}
