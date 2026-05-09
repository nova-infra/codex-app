package channel

import (
	"context"
	"fmt"

	"github.com/nova-infra/codex-app/internal/channel/lark"
	"github.com/nova-infra/codex-app/internal/channel/telegram"
	"github.com/nova-infra/codex-app/internal/channel/weixin"
	"github.com/nova-infra/codex-app/internal/render"
)

type ChannelRenderer interface {
	Render(ctx context.Context, target render.RenderTarget, events []render.Event, profile render.DisplayProfile) ([]render.PlatformMessage, error)
}

func RenderDemo(channelName string) ([]render.PlatformMessage, error) {
	return RenderDemoWithChannel(channelName, render.SampleEvents())
}

func RenderDemoWithChannel(channelName string, events []render.Event) ([]render.PlatformMessage, error) {
	ch, err := render.ParseChannel(channelName)
	if err != nil {
		return nil, err
	}
	if ch == render.ChannelAll {
		return renderAll(events)
	}
	r, ok := renderers()[ch]
	if !ok || r == nil {
		return nil, fmt.Errorf("renderer missing for %s", ch)
	}
	profile := render.DefaultProfile(ch)
	return r.Render(context.Background(), render.RenderTarget{ChannelID: "demo", ThreadID: "thread-1"}, events, profile)
}

func renderAll(events []render.Event) ([]render.PlatformMessage, error) {
	channels := []render.Channel{render.ChannelTelegram, render.ChannelWeixin, render.ChannelLark}
	messages := []render.PlatformMessage{}
	for _, ch := range channels {
		part, err := RenderDemoWithChannel(string(ch), events)
		if err != nil {
			return nil, err
		}
		messages = append(messages, part...)
	}
	return messages, nil
}

func renderers() map[render.Channel]ChannelRenderer {
	return map[render.Channel]ChannelRenderer{
		render.ChannelTelegram: telegram.NewRenderer(),
		render.ChannelWeixin:   weixin.NewRenderer(),
		render.ChannelLark:     lark.NewRenderer(),
	}
}
