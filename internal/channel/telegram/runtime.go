package telegram

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"github.com/nova-infra/codex-app/internal/channelapi"
)

type RuntimeConfig struct {
	BotToken string `json:"bot_token"`
	APIBase  string `json:"api_base"`
}

type Runtime struct {
	Config RuntimeConfig
}

func NewRuntime(cfg RuntimeConfig) (*Runtime, error) {
	if err := validate(cfg); err != nil {
		return nil, err
	}
	return &Runtime{Config: cfg}, nil
}

func (r *Runtime) ValidateConfig() error {
	return validate(r.Config)
}

func (r *Runtime) Send(_ context.Context, msg channelapi.RuntimeMessage) error {
	if strings.TrimSpace(msg.Text) == "" {
		return fmt.Errorf("telegram runtime requires non-empty text")
	}
	return nil
}

func (r *Runtime) GetUpdates(_ context.Context, limit int) ([]channelapi.RuntimeUpdate, error) {
	if limit < 0 {
		return nil, fmt.Errorf("telegram runtime limit must be >=0")
	}
	if strings.TrimSpace(r.Config.BotToken) == "" {
		return nil, fmt.Errorf("telegram bot token is not set")
	}
	return nil, nil
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
