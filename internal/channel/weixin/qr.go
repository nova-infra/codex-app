package weixin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

type QRCodeResponse struct {
	QRCode    string `json:"qrcode"`
	QRCodeURL string `json:"qrcode_url"`
}

type QRCodeStatus struct {
	Status       string `json:"status"`
	TokenPresent bool   `json:"token_present"`
	BaseURL      string `json:"base_url,omitempty"`
}

func GetQRCode(ctx context.Context, baseURL string) (QRCodeResponse, error) {
	endpoint := strings.TrimRight(normalizeILinkBase(baseURL), "/") + "/ilink/bot/get_bot_qrcode?bot_type=3"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return QRCodeResponse{}, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return QRCodeResponse{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return QRCodeResponse{}, fmt.Errorf("weixin ilink qrcode status %d", resp.StatusCode)
	}
	var payload map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return QRCodeResponse{}, err
	}
	if err := ilinkAPIError(payload, "qrcode"); err != nil {
		return QRCodeResponse{}, err
	}
	qrcode := stringField(payload, "qrcode")
	qrURL := firstStringField(payload, "qrcode_url", "qrcode_img_content", "qrcodeImgContent")
	if data, ok := payload["data"].(map[string]any); qrURL == "" && ok {
		qrURL = firstStringField(data, "qrcode_url", "qrcode_img_content")
	}
	if qrcode == "" || qrURL == "" {
		return QRCodeResponse{}, fmt.Errorf("weixin ilink qrcode response missing qrcode or qrcode_url")
	}
	return QRCodeResponse{QRCode: qrcode, QRCodeURL: qrURL}, nil
}

func GetQRCodeStatus(ctx context.Context, baseURL string, qrcode string) (QRCodeStatus, string, error) {
	if strings.TrimSpace(qrcode) == "" {
		return QRCodeStatus{}, "", fmt.Errorf("weixin ilink qrcode is required")
	}
	endpoint := strings.TrimRight(normalizeILinkBase(baseURL), "/") + "/ilink/bot/get_qrcode_status?qrcode=" + url.QueryEscape(qrcode)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return QRCodeStatus{}, "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return QRCodeStatus{}, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return QRCodeStatus{}, "", fmt.Errorf("weixin ilink qrcode status http %d", resp.StatusCode)
	}
	var payload map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return QRCodeStatus{}, "", err
	}
	if err := ilinkAPIError(payload, "qrcode status"); err != nil {
		return QRCodeStatus{}, "", err
	}
	status := normalizeQRStatus(stringField(payload, "status"))
	token := firstStringField(payload, "bot_token", "botToken")
	base := firstStringField(payload, "baseurl", "base_url")
	return QRCodeStatus{Status: status, TokenPresent: token != "", BaseURL: base}, token, nil
}

func normalizeILinkBase(baseURL string) string {
	if strings.TrimSpace(baseURL) == "" {
		return "https://ilinkai.weixin.qq.com"
	}
	return strings.TrimSpace(baseURL)
}

func normalizeQRStatus(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "scaned", "scanned":
		return "scanned"
	case "confirmed":
		return "confirmed"
	case "expired":
		return "expired"
	default:
		return "pending"
	}
}

func ilinkAPIError(payload map[string]any, label string) error {
	ret, hasRet := numericField(payload, "ret")
	errcode, hasErr := numericField(payload, "errcode")
	if (hasRet && ret != 0) || (hasErr && errcode != 0) {
		return fmt.Errorf("weixin ilink %s rejected: ret=%d errcode=%d errmsg=%s", label, ret, errcode, stringField(payload, "errmsg"))
	}
	return nil
}

func numericField(payload map[string]any, key string) (int, bool) {
	value, ok := payload[key]
	if !ok {
		return 0, false
	}
	if number, ok := value.(float64); ok {
		return int(number), true
	}
	return 0, false
}

func firstStringField(payload map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := stringField(payload, key); value != "" {
			return value
		}
	}
	return ""
}

func stringField(payload map[string]any, key string) string {
	if value, ok := payload[key].(string); ok {
		return strings.TrimSpace(value)
	}
	return ""
}
