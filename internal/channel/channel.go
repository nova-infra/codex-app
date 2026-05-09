package channel

import (
	"context"
	"fmt"
	"sort"

	"github.com/nova-infra/codex-app/internal/channel/lark"
	"github.com/nova-infra/codex-app/internal/channel/telegram"
	"github.com/nova-infra/codex-app/internal/channel/weixin"
	"github.com/nova-infra/codex-app/internal/render"
)

type ChannelRenderer interface {
	Render(ctx context.Context, target render.RenderTarget, events []render.Event, profile render.DisplayProfile) ([]render.PlatformMessage, error)
}

type channelSpec struct {
	constructor  func() ChannelRenderer
	capabilities []render.Capability
}

var (
	channelSpecs = map[render.Channel]channelSpec{
		render.ChannelTelegram: {
			constructor:  func() ChannelRenderer { return telegram.NewRenderer() },
			capabilities: render.DefaultProfile(render.ChannelTelegram).Capabilities,
		},
		render.ChannelWeixin: {
			constructor:  func() ChannelRenderer { return weixin.NewRenderer() },
			capabilities: render.DefaultProfile(render.ChannelWeixin).Capabilities,
		},
		render.ChannelLark: {
			constructor:  func() ChannelRenderer { return lark.NewRenderer() },
			capabilities: render.DefaultProfile(render.ChannelLark).Capabilities,
		},
	}
	supportedChannels = []render.Channel{render.ChannelTelegram, render.ChannelWeixin, render.ChannelLark}
)

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
	channels := ListChannels()
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
	result := make(map[render.Channel]ChannelRenderer, len(channelSpecs))
	for channel, spec := range channelSpecs {
		result[channel] = spec.constructor()
	}
	return result
}

func ListChannels() []render.Channel {
	out := make([]render.Channel, 0, len(supportedChannels))
	out = append(out, supportedChannels...)
	return out
}

func Capabilities(channelName string) ([]render.Capability, error) {
	channel, err := render.ParseChannel(channelName)
	if err != nil {
		return nil, err
	}
	if channel == render.ChannelAll {
		all := []render.Capability{}
		for _, spec := range channelSpecs {
			all = append(all, spec.capabilities...)
		}
		sort.SliceStable(all, func(i, j int) bool {
			return all[i] < all[j]
		})
		return uniqueCapabilities(all), nil
	}
	spec, ok := channelSpecs[channel]
	if !ok {
		return nil, fmt.Errorf("renderer missing for %s", channel)
	}
	capabilities := append([]render.Capability(nil), spec.capabilities...)
	return capabilities, nil
}

func uniqueCapabilities(in []render.Capability) []render.Capability {
	seen := map[render.Capability]struct{}{}
	out := make([]render.Capability, 0, len(in))
	for _, cap := range in {
		if _, exists := seen[cap]; exists {
			continue
		}
		seen[cap] = struct{}{}
		out = append(out, cap)
	}
	return out
}
