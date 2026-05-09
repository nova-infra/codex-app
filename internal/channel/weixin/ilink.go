package weixin

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/nova-infra/codex-app/internal/channelapi"
)

const defaultILinkTimeoutMs = 38000

type iLinkUpdateResponse struct {
	Ret                  int            `json:"ret"`
	ErrCode              int            `json:"errcode"`
	ErrMsg               string         `json:"errmsg"`
	Messages             []iLinkMessage `json:"msgs"`
	MessageList          []iLinkMessage `json:"msg_list"`
	GetUpdatesBuf        string         `json:"get_updates_buf"`
	LongPollingTimeoutMs int            `json:"longpolling_timeout_ms"`
}

type iLinkMessage struct {
	FromUserID   string      `json:"from_user_id"`
	Seq          int64       `json:"seq"`
	MessageID    int64       `json:"message_id"`
	ContextToken string      `json:"context_token"`
	ItemList     []iLinkItem `json:"item_list"`
}

type iLinkItem struct {
	Type     int `json:"type"`
	TextItem struct {
		Text string `json:"text"`
	} `json:"text_item"`
	VoiceItem struct {
		Text string `json:"text"`
	} `json:"voice_item"`
}

type UpdatesPage struct {
	Updates []channelapi.RuntimeUpdate
	Cursor  string
}

func (r *Runtime) getILinkUpdates(ctx context.Context, cursor string, limit int, timeoutMs int) ([]channelapi.RuntimeUpdate, error) {
	page, err := r.GetUpdatesPage(ctx, cursor, limit, timeoutMs)
	if err != nil {
		return nil, err
	}
	return page.Updates, nil
}

func (r *Runtime) GetUpdatesPage(ctx context.Context, cursor string, limit int, timeoutMs int) (UpdatesPage, error) {
	if timeoutMs <= 0 {
		timeoutMs = defaultILinkTimeoutMs
	}
	body := map[string]any{
		"base_info":              map[string]string{"channel_version": "2.0.0"},
		"get_updates_buf":        cursor,
		"longpolling_timeout_ms": timeoutMs,
	}
	var payload iLinkUpdateResponse
	if err := r.postILinkJSON(ctx, "/ilink/bot/getupdates", body, &payload); err != nil {
		return UpdatesPage{}, err
	}
	if payload.Ret != 0 || payload.ErrCode != 0 {
		return UpdatesPage{}, fmt.Errorf("weixin ilink getupdates rejected: ret=%d errcode=%d errmsg=%s", payload.Ret, payload.ErrCode, payload.ErrMsg)
	}
	messages := payload.Messages
	if len(messages) == 0 {
		messages = payload.MessageList
	}
	return UpdatesPage{
		Updates: iLinkMessagesToUpdates(messages, payload.GetUpdatesBuf, limit),
		Cursor:  strings.TrimSpace(payload.GetUpdatesBuf),
	}, nil
}

func (r *Runtime) sendILinkMessage(ctx context.Context, msg channelapi.RuntimeMessage) error {
	contextToken := ""
	if msg.Metadata != nil {
		contextToken = strings.TrimSpace(msg.Metadata["context_token"])
	}
	body := map[string]any{
		"base_info": map[string]string{"channel_version": "2.0.0"},
		"msg": map[string]any{
			"from_user_id":  "",
			"to_user_id":    strings.TrimSpace(msg.ChannelID),
			"client_id":     "codex-app-go",
			"message_type":  2,
			"message_state": 2,
			"context_token": contextToken,
			"item_list":     []map[string]any{{"type": 1, "text_item": map[string]string{"text": msg.Text}}},
		},
	}
	var response struct {
		Ret     int    `json:"ret"`
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
	}
	if err := r.postILinkJSON(ctx, "/ilink/bot/sendmessage", body, &response); err != nil {
		return err
	}
	if response.Ret != 0 || response.ErrCode != 0 {
		return fmt.Errorf("weixin ilink send rejected: ret=%d errcode=%d errmsg=%s", response.Ret, response.ErrCode, response.ErrMsg)
	}
	return nil
}

func (r *Runtime) postILinkJSON(ctx context.Context, path string, body any, target any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	endpoint := strings.TrimRight(strings.TrimSpace(r.Config.ILinkBase), "/") + path
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	for key, value := range r.iLinkHeaders() {
		req.Header.Set(key, value)
	}
	resp, err := r.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("weixin ilink api status %d", resp.StatusCode)
	}
	if target == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(target)
}

func (r *Runtime) iLinkHeaders() map[string]string {
	return map[string]string{
		"Content-Type":      "application/json",
		"AuthorizationType": "ilink_bot_token",
		"X-WECHAT-UIN":      randomUIN(),
		"Authorization":     "Bearer " + strings.TrimSpace(r.Config.BotToken),
	}
}

func iLinkMessagesToUpdates(messages []iLinkMessage, cursor string, limit int) []channelapi.RuntimeUpdate {
	updates := make([]channelapi.RuntimeUpdate, 0, len(messages))
	for _, msg := range messages {
		if limit > 0 && len(updates) >= limit {
			break
		}
		text := extractILinkText(msg.ItemList)
		if strings.TrimSpace(text) == "" || strings.TrimSpace(msg.FromUserID) == "" {
			continue
		}
		updates = append(updates, channelapi.RuntimeUpdate{
			UpdateID:  iLinkUpdateID(msg),
			Type:      "message",
			ChannelID: strings.TrimSpace(msg.FromUserID),
			Payload:   text,
			Metadata:  map[string]string{"context_token": msg.ContextToken, "cursor": cursor},
		})
	}
	return updates
}

func iLinkUpdateID(msg iLinkMessage) int64 {
	if msg.MessageID != 0 {
		return msg.MessageID
	}
	return msg.Seq
}

func extractILinkText(items []iLinkItem) string {
	parts := []string{}
	for _, item := range items {
		if text := strings.TrimSpace(item.TextItem.Text); text != "" {
			parts = append(parts, text)
		}
		if text := strings.TrimSpace(item.VoiceItem.Text); text != "" {
			parts = append(parts, text)
		}
	}
	return strings.TrimSpace(strings.Join(parts, "\n"))
}

func randomUIN() string {
	var buf [4]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "MA=="
	}
	return base64.StdEncoding.EncodeToString(buf[:])
}
