package weixin

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"testing"

	"github.com/nova-infra/codex-app/internal/channelapi"
)

func TestWeixinRuntimeValidate(t *testing.T) {
	_, err := NewRuntime(RuntimeConfig{CorpID: "corp", CorpSecret: "secret", AgentID: "agent"})
	if err != nil {
		t.Fatalf("runtime valid: %v", err)
	}
}

func TestWeixinRuntimeSendRequiresChannelID(t *testing.T) {
	rt, err := NewRuntime(RuntimeConfig{CorpID: "corp", CorpSecret: "secret", AgentID: "agent"})
	if err != nil {
		t.Fatalf("init runtime: %v", err)
	}
	if err := rt.Send(context.Background(), channelapi.RuntimeMessage{}); err == nil {
		t.Fatal("expected channel id validation error")
	}
}

func TestWeixinRuntimeAccessTokenCallsHTTPBoundary(t *testing.T) {
	client := roundTripClient(func(r *http.Request) *http.Response {
		if r.URL.Path != "/cgi-bin/gettoken" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("corpid"); got != "corp" {
			t.Fatalf("corpid = %q", got)
		}
		return jsonResponse(`{"errcode":0,"errmsg":"ok","access_token":"access-token","expires_in":7200}`)
	})
	rt, err := NewRuntime(RuntimeConfig{CorpID: "corp", CorpSecret: "secret", AgentID: "agent", APIBase: "https://weixin.example", HTTPClient: client})
	if err != nil {
		t.Fatalf("init runtime: %v", err)
	}
	token, err := rt.AccessToken(context.Background())
	if err != nil {
		t.Fatalf("access token: %v", err)
	}
	if token != "access-token" {
		t.Fatalf("unexpected token: %q", token)
	}
}

func TestWeixinRuntimeSendCallsHTTPBoundary(t *testing.T) {
	calls := 0
	client := roundTripClient(func(r *http.Request) *http.Response {
		calls++
		switch calls {
		case 1:
			if r.URL.Path != "/cgi-bin/gettoken" {
				t.Fatalf("unexpected token path: %s", r.URL.Path)
			}
			return jsonResponse(`{"errcode":0,"errmsg":"ok","access_token":"access-token","expires_in":7200}`)
		case 2:
			if r.URL.Path != "/cgi-bin/message/send" {
				t.Fatalf("unexpected send path: %s", r.URL.Path)
			}
			if got := r.URL.Query().Get("access_token"); got != "access-token" {
				t.Fatalf("access_token = %q", got)
			}
			body, _ := io.ReadAll(r.Body)
			if !bytes.Contains(body, []byte(`"touser":"user-1"`)) || !bytes.Contains(body, []byte(`"content":"hello"`)) {
				t.Fatalf("unexpected body: %s", string(body))
			}
			return jsonResponse(`{"errcode":0,"errmsg":"ok"}`)
		default:
			t.Fatalf("unexpected call %d", calls)
			return jsonResponse(`{"errcode":1,"errmsg":"unexpected"}`)
		}
	})
	rt, err := NewRuntime(RuntimeConfig{CorpID: "corp", CorpSecret: "secret", AgentID: "agent", APIBase: "https://weixin.example", HTTPClient: client})
	if err != nil {
		t.Fatalf("init runtime: %v", err)
	}
	if err := rt.Send(context.Background(), channelapi.RuntimeMessage{ChannelID: "user-1", Text: "hello"}); err != nil {
		t.Fatalf("send: %v", err)
	}
}

func TestWeixinRuntimeILinkGetUpdatesCallsHTTPBoundary(t *testing.T) {
	client := roundTripClient(func(r *http.Request) *http.Response {
		if r.URL.Path != "/ilink/bot/getupdates" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if got := r.Header.Get("AuthorizationType"); got != "ilink_bot_token" {
			t.Fatalf("AuthorizationType = %q", got)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer bot-token" {
			t.Fatalf("Authorization = %q", got)
		}
		body, _ := io.ReadAll(r.Body)
		if !bytes.Contains(body, []byte(`"get_updates_buf":"cursor-1"`)) {
			t.Fatalf("unexpected body: %s", string(body))
		}
		if !bytes.Contains(body, []byte(`"longpolling_timeout_ms":1000`)) {
			t.Fatalf("missing long polling timeout: %s", string(body))
		}
		return jsonResponse(`{"ret":0,"get_updates_buf":"cursor-2","msgs":[{"from_user_id":"user-1","message_id":7,"context_token":"ctx","item_list":[{"type":1,"text_item":{"text":"hello"}}]}]}`)
	})
	rt, err := NewRuntime(RuntimeConfig{BotToken: "bot-token", ILinkBase: "https://ilink.example", HTTPClient: client})
	if err != nil {
		t.Fatalf("init runtime: %v", err)
	}
	updates, err := rt.GetUpdatesSince(context.Background(), "cursor-1", 10, 1000)
	if err != nil {
		t.Fatalf("get updates: %v", err)
	}
	if len(updates) != 1 || updates[0].ChannelID != "user-1" || updates[0].Payload != "hello" {
		t.Fatalf("unexpected updates: %#v", updates)
	}
	if updates[0].Metadata["context_token"] != "ctx" || updates[0].Metadata["cursor"] != "cursor-2" {
		t.Fatalf("unexpected metadata: %#v", updates[0].Metadata)
	}
}

func TestWeixinRuntimeILinkGetUpdatesPageKeepsEmptyCursor(t *testing.T) {
	client := roundTripClient(func(r *http.Request) *http.Response {
		if r.URL.Path != "/ilink/bot/getupdates" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		return jsonResponse(`{"ret":0,"get_updates_buf":"cursor-next","msgs":[]}`)
	})
	rt, err := NewRuntime(RuntimeConfig{BotToken: "bot-token", ILinkBase: "https://ilink.example", HTTPClient: client})
	if err != nil {
		t.Fatalf("init runtime: %v", err)
	}
	page, err := rt.GetUpdatesPage(context.Background(), "cursor-1", 10, 1000)
	if err != nil {
		t.Fatalf("get updates page: %v", err)
	}
	if len(page.Updates) != 0 {
		t.Fatalf("updates = %#v, want none", page.Updates)
	}
	if page.Cursor != "cursor-next" {
		t.Fatalf("cursor = %q, want cursor-next", page.Cursor)
	}
}

func TestWeixinRuntimeILinkSendCallsHTTPBoundary(t *testing.T) {
	client := roundTripClient(func(r *http.Request) *http.Response {
		if r.URL.Path != "/ilink/bot/sendmessage" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		if !bytes.Contains(body, []byte(`"to_user_id":"user-1"`)) ||
			!bytes.Contains(body, []byte(`"context_token":"ctx"`)) ||
			!bytes.Contains(body, []byte(`"text":"hello"`)) {
			t.Fatalf("unexpected body: %s", string(body))
		}
		return jsonResponse(`{"ret":0,"errcode":0}`)
	})
	rt, err := NewRuntime(RuntimeConfig{BotToken: "bot-token", ILinkBase: "https://ilink.example", HTTPClient: client})
	if err != nil {
		t.Fatalf("init runtime: %v", err)
	}
	err = rt.Send(context.Background(), channelapi.RuntimeMessage{
		ChannelID: "user-1",
		Text:      "hello",
		Metadata:  map[string]string{"context_token": "ctx"},
	})
	if err != nil {
		t.Fatalf("send: %v", err)
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
