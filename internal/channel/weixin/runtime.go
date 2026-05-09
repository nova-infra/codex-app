package weixin

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

type RuntimeConfig struct {
	CorpID     string       `json:"corp_id"`
	CorpSecret string       `json:"corp_secret"`
	AgentID    string       `json:"agent_id"`
	APIBase    string       `json:"api_base"`
	BotToken   string       `json:"bot_token"`
	ILinkBase  string       `json:"ilink_base"`
	HTTPClient *http.Client `json:"-"`
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
		CorpID:     os.Getenv("WEIXIN_CORP_ID"),
		CorpSecret: os.Getenv("WEIXIN_CORP_SECRET"),
		AgentID:    os.Getenv("WEIXIN_AGENT_ID"),
		APIBase:    os.Getenv("WEIXIN_API_BASE"),
		BotToken:   firstEnv("WEIXIN_ILINK_BOT_TOKEN", "WEIXIN_BOT_TOKEN"),
		ILinkBase:  os.Getenv("WEIXIN_ILINK_BASE"),
	})
}

func (r *Runtime) ValidateConfig() error {
	return validate(normalizeConfig(r.Config))
}

func (r *Runtime) AccessToken(ctx context.Context) (string, error) {
	if strings.TrimSpace(r.Config.CorpID) == "" ||
		strings.TrimSpace(r.Config.CorpSecret) == "" ||
		strings.TrimSpace(r.Config.AgentID) == "" {
		return "", fmt.Errorf("weixin access token requires corp credentials")
	}
	r.mu.Lock()
	if r.token.Value != "" && time.Now().Before(r.token.ExpiresAt) {
		value := r.token.Value
		r.mu.Unlock()
		return value, nil
	}
	r.mu.Unlock()

	value, ttl, err := r.fetchAccessToken(ctx)
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
		return fmt.Errorf("weixin runtime requires channel_id")
	}
	if strings.TrimSpace(msg.Text) == "" {
		return fmt.Errorf("weixin runtime requires non-empty text")
	}
	if strings.TrimSpace(r.Config.BotToken) != "" {
		return r.sendILinkMessage(ctx, msg)
	}
	token, err := r.AccessToken(ctx)
	if err != nil {
		return err
	}
	body := map[string]any{
		"touser":  strings.TrimSpace(msg.ChannelID),
		"msgtype": "text",
		"agentid": r.Config.AgentID,
		"text":    map[string]string{"content": msg.Text},
		"safe":    0,
	}
	endpoint := apiURL(r.Config, "/cgi-bin/message/send") + "?access_token=" + url.QueryEscape(token)
	return r.postJSON(ctx, endpoint, body, nil)
}

func (r *Runtime) GetUpdates(ctx context.Context, limit int) ([]channelapi.RuntimeUpdate, error) {
	if limit < 0 {
		return nil, fmt.Errorf("weixin runtime limit must be >=0")
	}
	if strings.TrimSpace(r.Config.BotToken) != "" {
		return r.GetUpdatesSince(ctx, "", limit, 0)
	}
	return []channelapi.RuntimeUpdate{}, nil
}

func (r *Runtime) GetUpdatesSince(ctx context.Context, cursor string, limit int, timeoutMs int) ([]channelapi.RuntimeUpdate, error) {
	if limit < 0 {
		return nil, fmt.Errorf("weixin runtime limit must be >=0")
	}
	if strings.TrimSpace(r.Config.BotToken) == "" {
		return []channelapi.RuntimeUpdate{}, nil
	}
	return r.getILinkUpdates(ctx, cursor, limit, timeoutMs)
}

func validate(cfg RuntimeConfig) error {
	if strings.TrimSpace(cfg.BotToken) == "" {
		if strings.TrimSpace(cfg.CorpID) == "" {
			return fmt.Errorf("weixin runtime requires corp_id or bot_token")
		}
		if strings.TrimSpace(cfg.CorpSecret) == "" {
			return fmt.Errorf("weixin runtime requires corp_secret")
		}
		if strings.TrimSpace(cfg.AgentID) == "" {
			return fmt.Errorf("weixin runtime requires agent_id")
		}
	}
	if strings.TrimSpace(cfg.APIBase) == "" {
		return fmt.Errorf("weixin runtime requires api_base")
	}
	if _, err := url.ParseRequestURI(cfg.APIBase); err != nil {
		return fmt.Errorf("weixin runtime api_base invalid: %w", err)
	}
	if strings.TrimSpace(cfg.ILinkBase) == "" {
		return fmt.Errorf("weixin runtime requires ilink_base")
	}
	if _, err := url.ParseRequestURI(cfg.ILinkBase); err != nil {
		return fmt.Errorf("weixin runtime ilink_base invalid: %w", err)
	}
	return nil
}

func normalizeConfig(cfg RuntimeConfig) RuntimeConfig {
	if strings.TrimSpace(cfg.APIBase) == "" {
		cfg.APIBase = "https://qyapi.weixin.qq.com"
	}
	if strings.TrimSpace(cfg.ILinkBase) == "" {
		cfg.ILinkBase = "https://ilinkai.weixin.qq.com"
	}
	return cfg
}

func firstEnv(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

func httpClient(cfg RuntimeConfig) *http.Client {
	if cfg.HTTPClient != nil {
		return cfg.HTTPClient
	}
	return http.DefaultClient
}

func (r *Runtime) fetchAccessToken(ctx context.Context) (string, time.Duration, error) {
	query := url.Values{"corpid": {r.Config.CorpID}, "corpsecret": {r.Config.CorpSecret}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL(r.Config, "/cgi-bin/gettoken")+"?"+query.Encode(), nil)
	if err != nil {
		return "", 0, err
	}
	resp, err := r.client.Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", 0, fmt.Errorf("weixin api status %d", resp.StatusCode)
	}
	var payload struct {
		ErrCode     int    `json:"errcode"`
		ErrMsg      string `json:"errmsg"`
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return "", 0, err
	}
	if payload.ErrCode != 0 {
		return "", 0, fmt.Errorf("weixin token rejected: errcode=%d errmsg=%s", payload.ErrCode, payload.ErrMsg)
	}
	if strings.TrimSpace(payload.AccessToken) == "" {
		return "", 0, fmt.Errorf("weixin token response missing access_token")
	}
	ttl := time.Duration(payload.ExpiresIn-60) * time.Second
	if ttl <= 0 {
		ttl = 30 * time.Minute
	}
	return payload.AccessToken, ttl, nil
}

func (r *Runtime) postJSON(ctx context.Context, endpoint string, body any, out any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	resp, err := r.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("weixin api status %d", resp.StatusCode)
	}
	var base struct {
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
	}
	decoder := json.NewDecoder(resp.Body)
	if out == nil {
		if err := decoder.Decode(&base); err != nil {
			return err
		}
		if base.ErrCode != 0 {
			return fmt.Errorf("weixin api rejected: errcode=%d errmsg=%s", base.ErrCode, base.ErrMsg)
		}
		return nil
	}
	return decoder.Decode(out)
}

func apiURL(cfg RuntimeConfig, path string) string {
	return strings.TrimRight(strings.TrimSpace(normalizeConfig(cfg).APIBase), "/") + path
}
