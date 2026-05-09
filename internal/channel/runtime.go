package channel

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/nova-infra/codex-app/internal/channelapi"
	"github.com/nova-infra/codex-app/internal/render"
)

type RuntimeMessage = channelapi.RuntimeMessage

type RuntimeUpdate = channelapi.RuntimeUpdate

type Runtime = channelapi.ChannelRuntime

func RenderPayload(messages []render.PlatformMessage) ([]byte, error) {
	if len(messages) == 0 {
		return []byte("[]"), nil
	}
	payload, err := json.MarshalIndent(messages, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal payload: %w", err)
	}
	return payload, nil
}

// SendBatch sends messages for a runtime adapter.
func SendBatch(ctx context.Context, runtime Runtime, messages []RuntimeMessage) error {
	for _, msg := range messages {
		if err := runtime.Send(ctx, msg); err != nil {
			return err
		}
	}
	return nil
}
