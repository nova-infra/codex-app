package lark

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"github.com/nova-infra/codex-app/internal/channelapi"
)

type RuntimeConfig struct {
	AppID     string `json:"app_id"`
	AppSecret string `json:"app_secret"`
	APIBase   string `json:"api_base"`
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
		return fmt.Errorf("lark runtime requires non-empty text")
	}
	return nil
}

func (r *Runtime) GetUpdates(_ context.Context, limit int) ([]channelapi.RuntimeUpdate, error) {
	if limit < 0 {
		return nil, fmt.Errorf("lark runtime limit must be >=0")
	}
	return nil, nil
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
