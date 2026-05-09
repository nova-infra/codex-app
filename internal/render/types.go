package render

import (
	"fmt"
	"strings"
)

// Channel is the normalized social channel name used by render-demo.
type Channel string

const (
	ChannelTelegram Channel = "telegram"
	ChannelWeixin   Channel = "wechat"
	ChannelLark     Channel = "lark"
	ChannelAll      Channel = "all"
)

func ParseChannel(value string) (Channel, error) {
	switch Channel(strings.TrimSpace(strings.ToLower(value))) {
	case ChannelTelegram:
		return ChannelTelegram, nil
	case ChannelWeixin, "weixin":
		return ChannelWeixin, nil
	case ChannelLark, "feishu":
		return ChannelLark, nil
	case ChannelAll, "":
		return ChannelAll, nil
	default:
		return "", fmt.Errorf("unknown channel %q", value)
	}
}

type Capability string

const (
	CapabilityHTML        Capability = "html"
	CapabilityMarkdown    Capability = "markdown"
	CapabilityPlainText   Capability = "plain_text"
	CapabilityCard        Capability = "card"
	CapabilityButtons     Capability = "buttons"
	CapabilityEditMessage Capability = "edit_message"
)

type ToolProgress string

const (
	ToolProgressOff     ToolProgress = "off"
	ToolProgressCompact ToolProgress = "compact"
	ToolProgressCard    ToolProgress = "card"
)

type DisplayProfile struct {
	Channel           Channel      `json:"channel"`
	Name              string       `json:"name"`
	Capabilities      []Capability `json:"capabilities"`
	ShowReasoning     bool         `json:"show_reasoning"`
	ToolProgress      ToolProgress `json:"tool_progress"`
	ToolPreviewLength int          `json:"tool_preview_length"`
	Streaming         bool         `json:"streaming"`
	MessageUpdate     bool         `json:"message_update"`
	MaxTextChars      int          `json:"max_text_chars"`
}

func DefaultProfile(ch Channel) DisplayProfile {
	switch ch {
	case ChannelTelegram:
		return DisplayProfile{Channel: ch, Name: "Telegram", Capabilities: []Capability{CapabilityHTML, CapabilityButtons, CapabilityPlainText}, ToolProgress: ToolProgressCompact, ToolPreviewLength: 1200, Streaming: true, MessageUpdate: false, MaxTextChars: 4096}
	case ChannelWeixin:
		return DisplayProfile{Channel: ch, Name: "Weixin", Capabilities: []Capability{CapabilityPlainText}, ToolProgress: ToolProgressOff, ToolPreviewLength: 900, Streaming: false, MessageUpdate: false, MaxTextChars: 1800}
	case ChannelLark:
		return DisplayProfile{Channel: ch, Name: "Lark", Capabilities: []Capability{CapabilityMarkdown, CapabilityCard, CapabilityEditMessage, CapabilityPlainText}, ToolProgress: ToolProgressCard, ToolPreviewLength: 1600, Streaming: true, MessageUpdate: true, MaxTextChars: 6000}
	default:
		return DisplayProfile{Channel: ch, Name: string(ch), Capabilities: []Capability{CapabilityPlainText}, ToolProgress: ToolProgressCompact, ToolPreviewLength: 1000, MaxTextChars: 4000}
	}
}

type EventKind string

const (
	EventKindStarted   EventKind = "started"
	EventKindReasoning EventKind = "reasoning"
	EventKindTextDelta EventKind = "text_delta"
	EventKindToolStart EventKind = "tool_start"
	EventKindToolDone  EventKind = "tool_done"
	EventKindApproval  EventKind = "approval"
	EventKindMedia     EventKind = "media"
	EventKindError     EventKind = "error"
	EventKindFinal     EventKind = "final"
)

type Event struct {
	Kind     EventKind         `json:"kind"`
	Text     string            `json:"text,omitempty"`
	ToolName string            `json:"tool_name,omitempty"`
	ThreadID string            `json:"thread_id,omitempty"`
	Media    []MediaAttachment `json:"media,omitempty"`
	Approval *ApprovalRequest  `json:"approval,omitempty"`
	Metadata map[string]string `json:"metadata,omitempty"`
}

type MediaAttachment struct {
	Type string `json:"type"`
	URL  string `json:"url"`
	Name string `json:"name,omitempty"`
}

type ApprovalRequest struct {
	RequestID string `json:"request_id"`
	Title     string `json:"title"`
	Body      string `json:"body,omitempty"`
}

type RenderTarget struct {
	ChannelID string `json:"channel_id"`
	ThreadID  string `json:"thread_id,omitempty"`
}

type RenderBlock struct {
	Type     string            `json:"type"`
	Text     string            `json:"text,omitempty"`
	Metadata map[string]string `json:"metadata,omitempty"`
	Media    []MediaAttachment `json:"media,omitempty"`
}

type PlatformMessage struct {
	Channel  Channel        `json:"channel"`
	Target   RenderTarget   `json:"target"`
	Profile  DisplayProfile `json:"profile"`
	Blocks   []RenderBlock  `json:"blocks"`
	Warnings []string       `json:"warnings,omitempty"`
	Envelope map[string]any `json:"envelope,omitempty"`
}
