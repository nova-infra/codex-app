package channelapi

import "context"

type RuntimeMessage struct {
	Text      string            `json:"text"`
	ChannelID string            `json:"channel_id"`
	Metadata  map[string]string `json:"metadata,omitempty"`
}

type RuntimeUpdate struct {
	UpdateID  int64             `json:"update_id"`
	Type      string            `json:"type"`
	ChannelID string            `json:"channel_id,omitempty"`
	Payload   string            `json:"payload"`
	Metadata  map[string]string `json:"metadata,omitempty"`
}

type ChannelRuntime interface {
	Send(ctx context.Context, msg RuntimeMessage) error
	GetUpdates(ctx context.Context, limit int) ([]RuntimeUpdate, error)
	ValidateConfig() error
}
