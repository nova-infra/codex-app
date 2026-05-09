package kernel

import (
	"fmt"
	"strings"

	"github.com/nova-infra/codex-app/internal/channel"
	"github.com/nova-infra/codex-app/internal/config"
	"github.com/nova-infra/codex-app/internal/render"
)

type DemoRequest struct {
	Channel string
}

type DemoResult struct {
	Messages []render.PlatformMessage
}

func RenderDemo(req DemoRequest) (DemoResult, error) {
	channelName := normalizeChannel(req.Channel, config.Default().DefaultChannel)
	messages, err := channel.RenderDemo(channelName)
	if err != nil {
		return DemoResult{}, fmt.Errorf("render demo: %w", err)
	}
	return DemoResult{Messages: messages}, nil
}

func normalizeChannel(channelName string, fallback string) string {
	trimmed := strings.TrimSpace(strings.ToLower(channelName))
	if trimmed == "" {
		return fallback
	}
	return trimmed
}
