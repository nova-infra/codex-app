package lark

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/nova-infra/codex-app/internal/channelapi"
)

func TestLarkRuntimeValidate(t *testing.T) {
	_, err := NewRuntime(RuntimeConfig{AppID: "id", AppSecret: "secret", APIBase: "https://open.larkoffice.com"})
	if err != nil {
		t.Fatalf("runtime valid: %v", err)
	}
}

func TestLarkRuntimeGetUpdatesRejectNegative(t *testing.T) {
	rt, err := NewRuntime(RuntimeConfig{AppID: "id", AppSecret: "secret", APIBase: "https://open.larkoffice.com"})
	if err != nil {
		t.Fatalf("init runtime: %v", err)
	}
	if _, err := rt.GetUpdates(context.Background(), -1); err == nil {
		t.Fatal("expected negative limit validation error")
	}
}

func TestLarkRuntimeSendAndReplyCallOpenAPI(t *testing.T) {
	var tokenCalls int
	var sendCalls int
	var replyCalls int
	var reactionCalls int
	var deleteReactionCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		switch req.URL.Path {
		case "/open-apis/auth/v3/tenant_access_token/internal":
			tokenCalls++
			writeTestJSON(t, w, map[string]any{"code": 0, "msg": "ok", "tenant_access_token": "tenant-token", "expire": 7200})
		case "/open-apis/im/v1/messages":
			sendCalls++
			if got := req.Header.Get("Authorization"); got != "Bearer tenant-token" {
				t.Fatalf("unexpected authorization: %q", got)
			}
			if got := req.URL.Query().Get("receive_id_type"); got != "chat_id" {
				t.Fatalf("unexpected receive id type: %q", got)
			}
			var body map[string]string
			if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
				t.Fatalf("decode send body: %v", err)
			}
			if body["receive_id"] != "oc_123" || body["msg_type"] != "text" || !strings.Contains(body["content"], "hello") {
				t.Fatalf("unexpected send body: %#v", body)
			}
			writeTestJSON(t, w, map[string]any{"code": 0, "msg": "success"})
		case "/open-apis/im/v1/messages/om_1/reply":
			replyCalls++
			if got := req.Header.Get("Authorization"); got != "Bearer tenant-token" {
				t.Fatalf("unexpected reply authorization: %q", got)
			}
			var body map[string]string
			if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
				t.Fatalf("decode reply body: %v", err)
			}
			if body["msg_type"] != "text" || !strings.Contains(body["content"], "reply") {
				t.Fatalf("unexpected reply body: %#v", body)
			}
			writeTestJSON(t, w, map[string]any{"code": 0, "msg": "success"})
		case "/open-apis/im/v1/messages/om_1/reactions":
			reactionCalls++
			var body map[string]map[string]string
			if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
				t.Fatalf("decode reaction body: %v", err)
			}
			if body["reaction_type"]["emoji_type"] != "OnIt" {
				t.Fatalf("unexpected reaction body: %#v", body)
			}
			writeTestJSON(t, w, map[string]any{"code": 0, "msg": "success", "data": map[string]string{"reaction_id": "react_1"}})
		case "/open-apis/im/v1/messages/om_1/reactions/react_1":
			if req.Method != http.MethodDelete {
				t.Fatalf("unexpected reaction delete method: %s", req.Method)
			}
			deleteReactionCalls++
			writeTestJSON(t, w, map[string]any{"code": 0, "msg": "success"})
		default:
			t.Fatalf("unexpected path: %s", req.URL.Path)
		}
	}))
	defer server.Close()
	rt, err := NewRuntime(RuntimeConfig{AppID: "id", AppSecret: "secret", APIBase: server.URL})
	if err != nil {
		t.Fatalf("runtime: %v", err)
	}
	if err := rt.Send(context.Background(), channelapi.RuntimeMessage{ChannelID: "oc_123", Text: "hello"}); err != nil {
		t.Fatalf("send: %v", err)
	}
	if err := rt.Send(context.Background(), channelapi.RuntimeMessage{ChannelID: "oc_123", Text: "hello again"}); err != nil {
		t.Fatalf("send second: %v", err)
	}
	if err := rt.Reply(context.Background(), "om_1", "reply"); err != nil {
		t.Fatalf("reply: %v", err)
	}
	reactionID, err := rt.AddReaction(context.Background(), "om_1", "OnIt")
	if err != nil {
		t.Fatalf("add reaction: %v", err)
	}
	if reactionID != "react_1" {
		t.Fatalf("unexpected reaction id: %q", reactionID)
	}
	if err := rt.DeleteReaction(context.Background(), "om_1", reactionID); err != nil {
		t.Fatalf("delete reaction: %v", err)
	}
	if tokenCalls != 1 || sendCalls != 2 || replyCalls != 1 || reactionCalls != 1 || deleteReactionCalls != 1 {
		t.Fatalf("unexpected counts token=%d send=%d reply=%d reaction=%d delete=%d", tokenCalls, sendCalls, replyCalls, reactionCalls, deleteReactionCalls)
	}
}

func TestLarkRuntimeSendRejectEmptyMessage(t *testing.T) {
	rt, err := NewRuntime(RuntimeConfig{AppID: "id", AppSecret: "secret", APIBase: "https://open.larkoffice.com"})
	if err != nil {
		t.Fatalf("init runtime: %v", err)
	}
	if err := rt.Send(context.Background(), channelapi.RuntimeMessage{}); err == nil {
		t.Fatal("expected text validation error")
	}
}

func writeTestJSON(t *testing.T, w http.ResponseWriter, payload any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		t.Fatalf("write json: %v", err)
	}
}
