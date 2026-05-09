package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestStartDryRunReturnsPlan(t *testing.T) {
	out, err := Start(ServeOptions{DryRun: true})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if out == "" {
		t.Fatal("expected output")
	}
}

func TestStartLiveRequiresChannelCredentials(t *testing.T) {
	_, err := Start(ServeOptions{Addr: "127.0.0.1:0"})
	if err == nil {
		t.Fatal("expected missing channel credentials error")
	}
}

func TestServeHTTPRequiresChannelCredentials(t *testing.T) {
	plan, err := NewServePlanWithConfig(false, "", "", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	_, err = ServeHTTP(context.Background(), plan, nil)
	if err == nil {
		t.Fatal("expected missing channel credentials error")
	}
}

func TestDryRunRedactionUsesReadableMarker(t *testing.T) {
	t.Setenv("CODEX_APP_PROVIDER_CLIPROXY_API_KEY", "secret")
	out, err := Start(ServeOptions{DryRun: true})
	if err != nil {
		t.Fatalf("dry run: %v", err)
	}
	if !strings.Contains(out, `"OPENAI_API_KEY": "<redacted>"`) {
		t.Fatalf("expected readable redaction marker, got %q", out)
	}
	if strings.Contains(out, "secret") {
		t.Fatalf("dry-run leaked secret: %q", out)
	}
}

func TestStartLiveServesHealth(t *testing.T) {
	setChannelCredentials(t)
	ctx, cancel := context.WithCancel(context.Background())
	ready := make(chan string, 1)
	errc := make(chan error, 1)
	go func() {
		_, err := StartContext(ctx, ServeOptions{Addr: "127.0.0.1:0", Ready: ready})
		errc <- err
	}()
	addr := waitReady(t, ready)
	resp, err := http.Get("http://" + addr + "/health")
	if err != nil {
		t.Fatalf("get health: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("health status = %d", resp.StatusCode)
	}
	var payload map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("decode health: %v", err)
	}
	if payload["ok"] != true {
		t.Fatalf("expected ok health, got %#v", payload)
	}
	cancel()
	select {
	case err := <-errc:
		if err != nil {
			t.Fatalf("server stop: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("server did not stop")
	}
}

func TestHTTPServiceRenderDemo(t *testing.T) {
	plan, err := NewServePlanWithConfig(false, "", "", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	handler := NewHTTPService(plan).Routes()
	resp, err := callLocal(handler, "/render-demo?channel=telegram")
	if err != nil {
		t.Fatalf("render-demo request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("render-demo status = %d", resp.StatusCode)
	}
}

func waitReady(t *testing.T, ready <-chan string) string {
	t.Helper()
	select {
	case addr := <-ready:
		return addr
	case <-time.After(2 * time.Second):
		t.Fatal("server did not become ready")
	}
	return ""
}

func callLocal(handler http.Handler, target string) (*http.Response, error) {
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	handler.ServeHTTP(recorder, req)
	return recorder.Result(), nil
}

func setChannelCredentials(t *testing.T) {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	t.Setenv("TELEGRAM_BOT_TOKEN", "telegram-token")
	t.Setenv("WEIXIN_CORP_ID", "weixin-corp")
	t.Setenv("WEIXIN_CORP_SECRET", "weixin-secret")
	t.Setenv("WEIXIN_AGENT_ID", "weixin-agent")
	t.Setenv("LARK_APP_ID", "lark-app")
	t.Setenv("LARK_APP_SECRET", "lark-secret")
}
