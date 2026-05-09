package weixin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetQRCode(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/ilink/bot/get_bot_qrcode" || r.URL.Query().Get("bot_type") != "3" {
			t.Fatalf("unexpected request: %s?%s", r.URL.Path, r.URL.RawQuery)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"ret": 0, "qrcode": "qr-1", "qrcode_url": "https://qr.example"})
	}))
	defer server.Close()
	got, err := GetQRCode(context.Background(), server.URL)
	if err != nil {
		t.Fatalf("get qrcode: %v", err)
	}
	if got.QRCode != "qr-1" || got.QRCodeURL == "" {
		t.Fatalf("unexpected qrcode: %#v", got)
	}
}

func TestGetQRCodeStatusRedactsToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/ilink/bot/get_qrcode_status" || r.URL.Query().Get("qrcode") != "qr-1" {
			t.Fatalf("unexpected request: %s?%s", r.URL.Path, r.URL.RawQuery)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"ret": 0, "status": "confirmed", "bot_token": "secret-token", "baseurl": "https://ilink.example"})
	}))
	defer server.Close()
	status, token, err := GetQRCodeStatus(context.Background(), server.URL, "qr-1")
	if err != nil {
		t.Fatalf("get status: %v", err)
	}
	if status.Status != "confirmed" || !status.TokenPresent || status.BaseURL == "" {
		t.Fatalf("unexpected status: %#v", status)
	}
	if token != "secret-token" {
		t.Fatalf("expected raw token to be returned to caller only")
	}
}
