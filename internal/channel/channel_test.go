package channel

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/nova-infra/codex-app/internal/render"
)

func TestRenderPayload(t *testing.T) {
	msg := render.PlatformMessage{Channel: render.ChannelTelegram, Target: render.RenderTarget{ChannelID: "c1"}}
	bytes, err := RenderPayload([]render.PlatformMessage{msg})
	if err != nil {
		t.Fatalf("render payload: %v", err)
	}
	if !strings.Contains(string(bytes), "telegram") {
		t.Fatalf("expected channel in payload, got %s", bytes)
	}
}

func TestRenderPayloadEmpty(t *testing.T) {
	bytes, err := RenderPayload(nil)
	if err != nil {
		t.Fatalf("render payload: %v", err)
	}
	var v []any
	if err := json.Unmarshal(bytes, &v); err != nil {
		t.Fatalf("json unmarshal: %v", err)
	}
	if len(v) != 0 {
		t.Fatalf("expected empty array, got %v", string(bytes))
	}
}
