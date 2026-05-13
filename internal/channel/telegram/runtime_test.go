package telegram

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"testing"

	"github.com/nova-infra/codex-app/internal/channelapi"
)

func TestTelegramRuntimeValidate(t *testing.T) {
	_, err := NewRuntime(RuntimeConfig{BotToken: "x", APIBase: "https://api.telegram.org"})
	if err != nil {
		t.Fatalf("expected runtime config valid: %v", err)
	}
}

func TestTelegramRuntimeSendRejectEmptyMessage(t *testing.T) {
	rt, err := NewRuntime(RuntimeConfig{BotToken: "x", APIBase: "https://api.telegram.org"})
	if err != nil {
		t.Fatalf("init runtime: %v", err)
	}
	if err := rt.Send(context.Background(), channelapi.RuntimeMessage{}); err == nil {
		t.Fatal("expected send validation error")
	}
}

func TestTelegramRuntimeSendCallsHTTPBoundary(t *testing.T) {
	client := roundTripClient(func(r *http.Request) *http.Response {
		if r.URL.Path != "/bottoken/sendMessage" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if err := r.ParseForm(); err != nil {
			t.Fatalf("parse form: %v", err)
		}
		if got := r.Form.Get("chat_id"); got != "chat-1" {
			t.Fatalf("chat_id = %q", got)
		}
		return jsonResponse(`{"ok":true,"result":{"message_id":1}}`)
	})

	rt, err := NewRuntime(RuntimeConfig{BotToken: "token", APIBase: "https://telegram.example", HTTPClient: client})
	if err != nil {
		t.Fatalf("init runtime: %v", err)
	}
	err = rt.Send(context.Background(), channelapi.RuntimeMessage{ChannelID: "chat-1", Text: "hello"})
	if err != nil {
		t.Fatalf("send: %v", err)
	}
}

func TestTelegramRuntimeSendMessageReturnsMessageID(t *testing.T) {
	client := roundTripClient(func(r *http.Request) *http.Response {
		if r.URL.Path != "/bottoken/sendMessage" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		return jsonResponse(`{"ok":true,"result":{"message_id":77}}`)
	})

	rt, err := NewRuntime(RuntimeConfig{BotToken: "token", APIBase: "https://telegram.example", HTTPClient: client})
	if err != nil {
		t.Fatalf("init runtime: %v", err)
	}
	messageID, err := rt.SendMessage(context.Background(), channelapi.RuntimeMessage{ChannelID: "chat-1", Text: "hello"})
	if err != nil {
		t.Fatalf("send message: %v", err)
	}
	if messageID != 77 {
		t.Fatalf("message id = %d, want 77", messageID)
	}
}

func TestTelegramRuntimeEditMessageTextCallsHTTPBoundary(t *testing.T) {
	client := roundTripClient(func(r *http.Request) *http.Response {
		if r.URL.Path != "/bottoken/editMessageText" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if err := r.ParseForm(); err != nil {
			t.Fatalf("parse form: %v", err)
		}
		if got := r.Form.Get("chat_id"); got != "chat-1" {
			t.Fatalf("chat_id = %q", got)
		}
		if got := r.Form.Get("message_id"); got != "12" {
			t.Fatalf("message_id = %q", got)
		}
		if got := r.Form.Get("text"); got != "updated" {
			t.Fatalf("text = %q", got)
		}
		return jsonResponse(`{"ok":true,"result":true}`)
	})

	rt, err := NewRuntime(RuntimeConfig{BotToken: "token", APIBase: "https://telegram.example", HTTPClient: client})
	if err != nil {
		t.Fatalf("init runtime: %v", err)
	}
	if err := rt.EditMessageText(context.Background(), "chat-1", 12, "updated"); err != nil {
		t.Fatalf("edit message: %v", err)
	}
}

func TestTelegramRuntimeGetUpdatesCallsHTTPBoundary(t *testing.T) {
	client := roundTripClient(func(r *http.Request) *http.Response {
		if r.URL.Path != "/bottoken/getUpdates" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("limit"); got != "2" {
			t.Fatalf("limit = %q", got)
		}
		return jsonResponse(`{"ok":true,"result":[{"update_id":7,"message":{"text":"hi","chat":{"id":42}}}]}`)
	})

	rt, err := NewRuntime(RuntimeConfig{BotToken: "token", APIBase: "https://telegram.example", HTTPClient: client})
	if err != nil {
		t.Fatalf("init runtime: %v", err)
	}
	updates, err := rt.GetUpdates(context.Background(), 2)
	if err != nil {
		t.Fatalf("get updates: %v", err)
	}
	if len(updates) != 1 || updates[0].UpdateID != 7 || updates[0].Payload != "hi" || updates[0].ChannelID != "42" {
		t.Fatalf("unexpected updates: %#v", updates)
	}
}

func TestTelegramRuntimeGetUpdatesSinceCallsHTTPBoundary(t *testing.T) {
	client := roundTripClient(func(r *http.Request) *http.Response {
		if r.URL.Path != "/bottoken/getUpdates" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("offset"); got != "8" {
			t.Fatalf("offset = %q", got)
		}
		if got := r.URL.Query().Get("timeout"); got != "10" {
			t.Fatalf("timeout = %q", got)
		}
		return jsonResponse(`{"ok":true,"result":[]}`)
	})

	rt, err := NewRuntime(RuntimeConfig{BotToken: "token", APIBase: "https://telegram.example", HTTPClient: client})
	if err != nil {
		t.Fatalf("init runtime: %v", err)
	}
	if _, err := rt.GetUpdatesSince(context.Background(), 8, 2, 10); err != nil {
		t.Fatalf("get updates since: %v", err)
	}
}

func TestTelegramRuntimeGetMeCallsHTTPBoundary(t *testing.T) {
	client := roundTripClient(func(r *http.Request) *http.Response {
		if r.URL.Path != "/bottoken/getMe" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		return jsonResponse(`{"ok":true,"result":{"id":1,"is_bot":true,"username":"demo"}}`)
	})

	rt, err := NewRuntime(RuntimeConfig{BotToken: "token", APIBase: "https://telegram.example", HTTPClient: client})
	if err != nil {
		t.Fatalf("init runtime: %v", err)
	}
	me, err := rt.GetMeInfo(context.Background())
	if err != nil {
		t.Fatalf("get me: %v", err)
	}
	if me.Username != "demo" || me.ID != 1 {
		t.Fatalf("unexpected me: %#v", me)
	}
}

type roundTripFunc func(*http.Request) *http.Response

func (fn roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return fn(r), nil
}

func roundTripClient(fn roundTripFunc) *http.Client {
	return &http.Client{Transport: fn}
}

func jsonResponse(body string) *http.Response {
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(bytes.NewBufferString(body)),
		Header:     make(http.Header),
	}
}
