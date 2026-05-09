package telegram

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/nova-infra/codex-app/internal/channelapi"
)

type RuntimeConfig struct {
	BotToken   string       `json:"bot_token"`
	APIBase    string       `json:"api_base"`
	HTTPClient *http.Client `json:"-"`
}

type Runtime struct {
	Config RuntimeConfig
	client *http.Client
}

func NewRuntime(cfg RuntimeConfig) (*Runtime, error) {
	if err := validate(cfg); err != nil {
		return nil, err
	}
	return &Runtime{Config: cfg, client: httpClient(cfg)}, nil
}

func (r *Runtime) ValidateConfig() error {
	return validate(r.Config)
}

func (r *Runtime) Send(ctx context.Context, msg channelapi.RuntimeMessage) error {
	if strings.TrimSpace(msg.ChannelID) == "" {
		return fmt.Errorf("telegram runtime requires channel_id")
	}
	if strings.TrimSpace(msg.Text) == "" {
		return fmt.Errorf("telegram runtime requires non-empty text")
	}
	endpoint := apiURL(r.Config, "sendMessage", nil)
	form := url.Values{"chat_id": {msg.ChannelID}, "text": {msg.Text}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	return doTelegram(r.client, req)
}

func (r *Runtime) GetUpdates(ctx context.Context, limit int) ([]channelapi.RuntimeUpdate, error) {
	if limit < 0 {
		return nil, fmt.Errorf("telegram runtime limit must be >=0")
	}
	if strings.TrimSpace(r.Config.BotToken) == "" {
		return nil, fmt.Errorf("telegram bot token is not set")
	}
	query := url.Values{}
	if limit > 0 {
		query.Set("limit", strconv.Itoa(limit))
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL(r.Config, "getUpdates", query), nil)
	if err != nil {
		return nil, err
	}
	return readUpdates(r.client, req)
}

func validate(cfg RuntimeConfig) error {
	if strings.TrimSpace(cfg.BotToken) == "" {
		return fmt.Errorf("telegram runtime requires bot_token")
	}
	if strings.TrimSpace(cfg.APIBase) == "" {
		return fmt.Errorf("telegram runtime requires api_base")
	}
	if _, err := url.ParseRequestURI(cfg.APIBase); err != nil {
		return fmt.Errorf("telegram runtime api_base invalid: %w", err)
	}
	return nil
}

func httpClient(cfg RuntimeConfig) *http.Client {
	if cfg.HTTPClient != nil {
		return cfg.HTTPClient
	}
	return http.DefaultClient
}

func apiURL(cfg RuntimeConfig, method string, query url.Values) string {
	base := strings.TrimRight(strings.TrimSpace(cfg.APIBase), "/")
	endpoint := fmt.Sprintf("%s/bot%s/%s", base, url.PathEscape(strings.TrimSpace(cfg.BotToken)), method)
	if len(query) == 0 {
		return endpoint
	}
	return endpoint + "?" + query.Encode()
}

func doTelegram(client *http.Client, req *http.Request) error {
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("telegram api status %d", resp.StatusCode)
	}
	var payload struct {
		OK          bool   `json:"ok"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return err
	}
	if !payload.OK {
		return fmt.Errorf("telegram api rejected request: %s", payload.Description)
	}
	return nil
}

func readUpdates(client *http.Client, req *http.Request) ([]channelapi.RuntimeUpdate, error) {
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("telegram api status %d", resp.StatusCode)
	}
	var payload telegramUpdatesResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	if !payload.OK {
		return nil, fmt.Errorf("telegram api rejected request: %s", payload.Description)
	}
	return toRuntimeUpdates(payload.Result), nil
}

type telegramUpdatesResponse struct {
	OK          bool             `json:"ok"`
	Description string           `json:"description"`
	Result      []telegramUpdate `json:"result"`
}

type telegramUpdate struct {
	UpdateID int64 `json:"update_id"`
	Message  struct {
		Text string `json:"text"`
		Chat struct {
			ID int64 `json:"id"`
		} `json:"chat"`
	} `json:"message"`
}

func toRuntimeUpdates(items []telegramUpdate) []channelapi.RuntimeUpdate {
	updates := make([]channelapi.RuntimeUpdate, 0, len(items))
	for _, item := range items {
		updates = append(updates, channelapi.RuntimeUpdate{
			UpdateID: item.UpdateID,
			Type:     "message",
			Payload:  item.Message.Text,
		})
	}
	return updates
}
