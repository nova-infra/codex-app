package lark

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/nova-infra/codex-app/internal/channelapi"
)

const DefaultAPIBase = "https://open.larksuite.com"

type RuntimeConfig struct {
	AppID             string       `json:"app_id"`
	AppSecret         string       `json:"app_secret"`
	APIBase           string       `json:"api_base"`
	VerificationToken string       `json:"verification_token,omitempty"`
	HTTPClient        *http.Client `json:"-"`
}

type Runtime struct {
	Config RuntimeConfig
	client *http.Client
	mu     sync.Mutex
	token  cachedToken
}

type cachedToken struct {
	Value     string
	ExpiresAt time.Time
}

func NewRuntime(cfg RuntimeConfig) (*Runtime, error) {
	cfg = normalizeConfig(cfg)
	if err := validate(cfg); err != nil {
		return nil, err
	}
	return &Runtime{Config: cfg, client: httpClient(cfg)}, nil
}

func NewRuntimeFromEnv() (*Runtime, error) {
	return NewRuntime(RuntimeConfig{
		AppID:             os.Getenv("LARK_APP_ID"),
		AppSecret:         os.Getenv("LARK_APP_SECRET"),
		APIBase:           os.Getenv("LARK_API_BASE"),
		VerificationToken: os.Getenv("LARK_VERIFICATION_TOKEN"),
	})
}

func (r *Runtime) ValidateConfig() error {
	return validate(normalizeConfig(r.Config))
}

func (r *Runtime) TenantAccessToken(ctx context.Context) (string, error) {
	r.mu.Lock()
	if r.token.Value != "" && time.Now().Before(r.token.ExpiresAt) {
		value := r.token.Value
		r.mu.Unlock()
		return value, nil
	}
	r.mu.Unlock()

	value, ttl, err := r.fetchTenantAccessToken(ctx)
	if err != nil {
		return "", err
	}
	r.mu.Lock()
	r.token = cachedToken{Value: value, ExpiresAt: time.Now().Add(ttl)}
	r.mu.Unlock()
	return value, nil
}

func (r *Runtime) Send(ctx context.Context, msg channelapi.RuntimeMessage) error {
	if strings.TrimSpace(msg.ChannelID) == "" {
		return fmt.Errorf("lark runtime requires channel_id")
	}
	if strings.TrimSpace(msg.Text) == "" {
		return fmt.Errorf("lark runtime requires non-empty text")
	}
	token, err := r.TenantAccessToken(ctx)
	if err != nil {
		return err
	}
	content, err := json.Marshal(map[string]string{"text": msg.Text})
	if err != nil {
		return err
	}
	body := map[string]string{
		"receive_id": strings.TrimSpace(msg.ChannelID),
		"msg_type":   "text",
		"content":    string(content),
	}
	endpoint := apiURL(r.Config, "/open-apis/im/v1/messages") + "?receive_id_type=chat_id"
	return r.postJSON(ctx, endpoint, token, body, nil)
}

func (r *Runtime) Reply(ctx context.Context, messageID string, text string) error {
	if strings.TrimSpace(messageID) == "" {
		return fmt.Errorf("lark runtime requires message_id")
	}
	if strings.TrimSpace(text) == "" {
		return fmt.Errorf("lark runtime requires non-empty text")
	}
	token, err := r.TenantAccessToken(ctx)
	if err != nil {
		return err
	}
	content, err := json.Marshal(map[string]string{"text": text})
	if err != nil {
		return err
	}
	body := map[string]string{
		"msg_type": "text",
		"content":  string(content),
	}
	path := "/open-apis/im/v1/messages/" + url.PathEscape(strings.TrimSpace(messageID)) + "/reply"
	return r.postJSON(ctx, apiURL(r.Config, path), token, body, nil)
}

func (r *Runtime) AddReaction(ctx context.Context, messageID string, emojiType string) (string, error) {
	messageID = strings.TrimSpace(messageID)
	emojiType = strings.TrimSpace(emojiType)
	if messageID == "" {
		return "", fmt.Errorf("lark runtime requires message_id")
	}
	if emojiType == "" {
		return "", nil
	}
	token, err := r.TenantAccessToken(ctx)
	if err != nil {
		return "", err
	}
	body := map[string]any{"reaction_type": map[string]string{"emoji_type": emojiType}}
	var payload struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data struct {
			ReactionID string `json:"reaction_id"`
		} `json:"data"`
	}
	path := "/open-apis/im/v1/messages/" + url.PathEscape(messageID) + "/reactions"
	if err := r.postJSON(ctx, apiURL(r.Config, path), token, body, &payload); err != nil {
		return "", err
	}
	if payload.Code != 0 {
		return "", fmt.Errorf("lark reaction rejected: code=%d msg=%s", payload.Code, payload.Msg)
	}
	return strings.TrimSpace(payload.Data.ReactionID), nil
}

func (r *Runtime) DeleteReaction(ctx context.Context, messageID string, reactionID string) error {
	messageID = strings.TrimSpace(messageID)
	reactionID = strings.TrimSpace(reactionID)
	if messageID == "" || reactionID == "" {
		return nil
	}
	token, err := r.TenantAccessToken(ctx)
	if err != nil {
		return err
	}
	path := "/open-apis/im/v1/messages/" + url.PathEscape(messageID) + "/reactions/" + url.PathEscape(reactionID)
	return r.deleteJSON(ctx, apiURL(r.Config, path), token)
}

func (r *Runtime) GetUpdates(_ context.Context, limit int) ([]channelapi.RuntimeUpdate, error) {
	if limit < 0 {
		return nil, fmt.Errorf("lark runtime limit must be >=0")
	}
	return nil, nil
}

func (r *Runtime) fetchTenantAccessToken(ctx context.Context) (string, time.Duration, error) {
	body := map[string]string{"app_id": r.Config.AppID, "app_secret": r.Config.AppSecret}
	var payload struct {
		Code              int    `json:"code"`
		Msg               string `json:"msg"`
		TenantAccessToken string `json:"tenant_access_token"`
		Expire            int64  `json:"expire"`
	}
	endpoint := apiURL(r.Config, "/open-apis/auth/v3/tenant_access_token/internal")
	if err := r.postJSON(ctx, endpoint, "", body, &payload); err != nil {
		return "", 0, err
	}
	if payload.Code != 0 {
		return "", 0, fmt.Errorf("lark token rejected: code=%d msg=%s", payload.Code, payload.Msg)
	}
	if strings.TrimSpace(payload.TenantAccessToken) == "" {
		return "", 0, fmt.Errorf("lark token response missing tenant_access_token")
	}
	ttl := time.Duration(payload.Expire-60) * time.Second
	if ttl <= 0 {
		ttl = 30 * time.Minute
	}
	return payload.TenantAccessToken, ttl, nil
}

func (r *Runtime) postJSON(ctx context.Context, endpoint string, token string, body any, out any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	if strings.TrimSpace(token) != "" {
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token))
	}
	resp, err := r.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("lark api status %d", resp.StatusCode)
	}
	var base struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	decoder := json.NewDecoder(resp.Body)
	if out == nil {
		if err := decoder.Decode(&base); err != nil {
			return err
		}
		if base.Code != 0 {
			return fmt.Errorf("lark api rejected: code=%d msg=%s", base.Code, base.Msg)
		}
		return nil
	}
	if err := decoder.Decode(out); err != nil {
		return err
	}
	return nil
}

func (r *Runtime) deleteJSON(ctx context.Context, endpoint string, token string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
	if err != nil {
		return err
	}
	if strings.TrimSpace(token) != "" {
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token))
	}
	resp, err := r.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("lark api status %d", resp.StatusCode)
	}
	var base struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&base); err != nil {
		return err
	}
	if base.Code != 0 {
		return fmt.Errorf("lark api rejected: code=%d msg=%s", base.Code, base.Msg)
	}
	return nil
}

func normalizeConfig(cfg RuntimeConfig) RuntimeConfig {
	if strings.TrimSpace(cfg.APIBase) == "" {
		cfg.APIBase = DefaultAPIBase
	}
	return cfg
}

func validate(cfg RuntimeConfig) error {
	if strings.TrimSpace(cfg.AppID) == "" {
		return fmt.Errorf("lark runtime requires app_id")
	}
	if strings.TrimSpace(cfg.AppSecret) == "" {
		return fmt.Errorf("lark runtime requires app_secret")
	}
	if strings.TrimSpace(cfg.APIBase) == "" {
		return fmt.Errorf("lark runtime requires api_base")
	}
	if _, err := url.ParseRequestURI(cfg.APIBase); err != nil {
		return fmt.Errorf("lark runtime api_base invalid: %w", err)
	}
	return nil
}

func httpClient(cfg RuntimeConfig) *http.Client {
	if cfg.HTTPClient != nil {
		return cfg.HTTPClient
	}
	return http.DefaultClient
}

func apiURL(cfg RuntimeConfig, path string) string {
	base := strings.TrimRight(strings.TrimSpace(normalizeConfig(cfg).APIBase), "/")
	return base + path
}
