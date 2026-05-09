package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/nova-infra/codex-app/internal/channel/lark"
)

func TestLarkEventChallenge(t *testing.T) {
	service := larkEventService{runtime: larkRuntimeForChallenge(t)}
	req := httptest.NewRequest(http.MethodPost, "/lark/events", bytes.NewBufferString(`{"type":"url_verification","challenge":"abc"}`))
	rec := httptest.NewRecorder()
	service.handleEvent(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var payload map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload["challenge"] != "abc" {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}

func TestLarkEventMessageReplies(t *testing.T) {
	t.Setenv("CODEX_APP_DISABLE_CODEX", "true")
	fake := newFakeLarkAPI(t)
	defer fake.Close()
	runtime, err := lark.NewRuntime(lark.RuntimeConfig{AppID: "id", AppSecret: "secret", APIBase: fake.URL, VerificationToken: "verify"})
	if err != nil {
		t.Fatalf("runtime: %v", err)
	}
	service := larkEventService{runtime: runtime}
	body := `{
		"schema":"2.0",
		"header":{"event_type":"im.message.receive_v1","token":"verify"},
		"event":{"sender":{"sender_type":"user"},"message":{"chat_id":"oc_123","message_id":"om_1","message_type":"text","content":"{\"text\":\"ping\"}"}}
	}`
	req := httptest.NewRequest(http.MethodPost, "/lark/events", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	service.handleEvent(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if fake.replyCount != 1 || fake.lastMessageID != "om_1" || !strings.Contains(fake.lastText, "Codex App 已收到你的消息：ping") {
		t.Fatalf("unexpected reply: count=%d message=%q text=%q", fake.replyCount, fake.lastMessageID, fake.lastText)
	}

	if fake.reactionAdds != 1 {
		t.Fatalf("expected loading reaction add, got %d", fake.reactionAdds)
	}
	deadline := time.Now().Add(time.Second)
	for fake.reactionDels == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if fake.reactionDels != 1 {
		t.Fatalf("expected loading reaction delete, got %d", fake.reactionDels)
	}
}

func TestLarkEventRejectsBadToken(t *testing.T) {
	fake := newFakeLarkAPI(t)
	defer fake.Close()
	runtime, err := lark.NewRuntime(lark.RuntimeConfig{AppID: "id", AppSecret: "secret", APIBase: fake.URL, VerificationToken: "verify"})
	if err != nil {
		t.Fatalf("runtime: %v", err)
	}
	service := larkEventService{runtime: runtime}
	body := `{"header":{"event_type":"im.message.receive_v1","token":"bad"},"event":{"message":{"chat_id":"oc_123","content":"{\"text\":\"ping\"}"}}}`
	req := httptest.NewRequest(http.MethodPost, "/lark/events", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	service.handleEvent(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

type fakeLarkAPI struct {
	*httptest.Server
	t             *testing.T
	sendCount     int
	lastText      string
	lastReceiveID string
	replyCount    int
	lastMessageID string
	reactionAdds  int
	reactionDels  int
}

func newFakeLarkAPI(t *testing.T) *fakeLarkAPI {
	api := &fakeLarkAPI{t: t}
	api.Server = httptest.NewServer(http.HandlerFunc(api.handle))
	return api
}

func (f *fakeLarkAPI) handle(w http.ResponseWriter, req *http.Request) {
	switch req.URL.Path {
	case "/open-apis/auth/v3/tenant_access_token/internal":
		writeTestServerJSON(f.t, w, map[string]any{"code": 0, "msg": "ok", "tenant_access_token": "tenant-token", "expire": 7200})
	case "/open-apis/im/v1/messages":
		f.sendCount++
		var body map[string]string
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			f.t.Fatalf("decode send: %v", err)
		}
		f.lastReceiveID = body["receive_id"]
		var content map[string]string
		if err := json.Unmarshal([]byte(body["content"]), &content); err != nil {
			f.t.Fatalf("decode content: %v", err)
		}
		f.lastText = content["text"]
		writeTestServerJSON(f.t, w, map[string]any{"code": 0, "msg": "ok"})
	case "/open-apis/im/v1/messages/om_1/reactions":
		f.reactionAdds++
		var body map[string]map[string]string
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			f.t.Fatalf("decode reaction: %v", err)
		}
		if body["reaction_type"]["emoji_type"] != "OnIt" {
			f.t.Fatalf("unexpected reaction: %#v", body)
		}
		writeTestServerJSON(f.t, w, map[string]any{"code": 0, "msg": "ok", "data": map[string]string{"reaction_id": "react_1"}})
	case "/open-apis/im/v1/messages/om_1/reactions/react_1":
		f.reactionDels++
		writeTestServerJSON(f.t, w, map[string]any{"code": 0, "msg": "ok"})
	case "/open-apis/im/v1/messages/om_1/reply":
		f.replyCount++
		f.lastMessageID = "om_1"
		var body map[string]string
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			f.t.Fatalf("decode reply: %v", err)
		}
		var content map[string]string
		if err := json.Unmarshal([]byte(body["content"]), &content); err != nil {
			f.t.Fatalf("decode reply content: %v", err)
		}
		f.lastText = content["text"]
		writeTestServerJSON(f.t, w, map[string]any{"code": 0, "msg": "ok"})
	default:
		f.t.Fatalf("unexpected path: %s", req.URL.Path)
	}
}

func larkRuntimeForChallenge(t *testing.T) *lark.Runtime {
	t.Helper()
	runtime, err := lark.NewRuntime(lark.RuntimeConfig{AppID: "id", AppSecret: "secret", APIBase: "https://open.larksuite.com"})
	if err != nil {
		t.Fatalf("runtime: %v", err)
	}
	return runtime
}

func writeTestServerJSON(t *testing.T, w http.ResponseWriter, payload any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		t.Fatalf("write json: %v", err)
	}
}
