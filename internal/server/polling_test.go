package server

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/nova-infra/codex-app/internal/channel/weixin"
	"github.com/nova-infra/codex-app/internal/channelapi"
)

func TestTelegramPollingHandlesInboundReply(t *testing.T) {
	t.Setenv("CODEX_APP_DISABLE_CODEX", "true")
	runtime := &fakeTelegramPollRuntime{}
	runner := &telegramPollingRunner{runtime: runtime}

	runner.handleUpdates(context.Background(), []channelapi.RuntimeUpdate{{
		UpdateID:  42,
		ChannelID: "chat-1",
		Payload:   "hello",
	}})

	if runner.offset != 43 {
		t.Fatalf("offset = %d, want 43", runner.offset)
	}
	if len(runtime.sent) != 1 {
		t.Fatalf("sent count = %d, want 1", len(runtime.sent))
	}
	if runtime.sent[0].ChannelID != "chat-1" {
		t.Fatalf("sent channel = %q", runtime.sent[0].ChannelID)
	}
	if !strings.Contains(runtime.sent[0].Text, "hello") {
		t.Fatalf("reply text = %q", runtime.sent[0].Text)
	}
}

func TestTelegramPollingContinuesAfterReplyError(t *testing.T) {
	t.Setenv("CODEX_APP_DISABLE_CODEX", "true")
	runtime := &fakeTelegramPollRuntime{failFirstSend: true}
	runner := &telegramPollingRunner{runtime: runtime}

	runner.handleUpdates(context.Background(), []channelapi.RuntimeUpdate{
		{UpdateID: 10, ChannelID: "chat-1", Payload: "first"},
		{UpdateID: 11, ChannelID: "chat-2", Payload: "second"},
	})

	if runner.offset != 12 {
		t.Fatalf("offset = %d, want 12", runner.offset)
	}
	if len(runtime.sent) != 1 {
		t.Fatalf("sent count = %d, want 1", len(runtime.sent))
	}
	if runtime.sent[0].ChannelID != "chat-2" {
		t.Fatalf("sent channel = %q", runtime.sent[0].ChannelID)
	}
}

func TestWeixinPollingHandlesInboundReply(t *testing.T) {
	t.Setenv("CODEX_APP_DISABLE_CODEX", "true")
	runtime := &fakeWeixinPollRuntime{}
	runner := &weixinPollingRunner{runtime: runtime}

	runner.handleUpdates(context.Background(), []channelapi.RuntimeUpdate{{
		UpdateID:  8,
		ChannelID: "user-1",
		Payload:   "你好",
		Metadata:  map[string]string{"cursor": "cursor-2", "receive_id_type": "user_id"},
	}})

	if runner.cursor != "cursor-2" {
		t.Fatalf("cursor = %q, want cursor-2", runner.cursor)
	}
	if len(runtime.sent) != 1 {
		t.Fatalf("sent count = %d, want 1", len(runtime.sent))
	}
	if runtime.sent[0].ChannelID != "user-1" {
		t.Fatalf("sent channel = %q", runtime.sent[0].ChannelID)
	}
	if runtime.sent[0].Metadata["receive_id_type"] != "user_id" {
		t.Fatalf("sent metadata = %#v", runtime.sent[0].Metadata)
	}
	if !strings.Contains(runtime.sent[0].Text, "你好") {
		t.Fatalf("reply text = %q", runtime.sent[0].Text)
	}
}

func TestWeixinPollingContinuesAfterReplyError(t *testing.T) {
	t.Setenv("CODEX_APP_DISABLE_CODEX", "true")
	runtime := &fakeWeixinPollRuntime{failFirstSend: true}
	runner := &weixinPollingRunner{runtime: runtime}

	runner.handleUpdates(context.Background(), []channelapi.RuntimeUpdate{
		{UpdateID: 1, ChannelID: "user-1", Payload: "first", Metadata: map[string]string{"cursor": "cursor-1"}},
		{UpdateID: 2, ChannelID: "user-2", Payload: "second", Metadata: map[string]string{"cursor": "cursor-2"}},
	})

	if runner.cursor != "cursor-2" {
		t.Fatalf("cursor = %q, want cursor-2", runner.cursor)
	}
	if len(runtime.sent) != 1 {
		t.Fatalf("sent count = %d, want 1", len(runtime.sent))
	}
	if runtime.sent[0].ChannelID != "user-2" {
		t.Fatalf("sent channel = %q", runtime.sent[0].ChannelID)
	}
}

type fakeTelegramPollRuntime struct {
	sent          []channelapi.RuntimeMessage
	failFirstSend bool
}

func (f *fakeTelegramPollRuntime) Send(_ context.Context, msg channelapi.RuntimeMessage) error {
	if f.failFirstSend {
		f.failFirstSend = false
		return errors.New("send failed")
	}
	f.sent = append(f.sent, msg)
	return nil
}

func (f *fakeTelegramPollRuntime) GetUpdatesSince(_ context.Context, _ int64, _ int, _ int) ([]channelapi.RuntimeUpdate, error) {
	return nil, nil
}

type fakeWeixinPollRuntime struct {
	sent          []channelapi.RuntimeMessage
	failFirstSend bool
}

func (f *fakeWeixinPollRuntime) Send(_ context.Context, msg channelapi.RuntimeMessage) error {
	if f.failFirstSend {
		f.failFirstSend = false
		return errors.New("send failed")
	}
	f.sent = append(f.sent, msg)
	return nil
}

func (f *fakeWeixinPollRuntime) GetUpdatesPage(_ context.Context, _ string, _ int, _ int) (weixin.UpdatesPage, error) {
	return weixin.UpdatesPage{}, nil
}
