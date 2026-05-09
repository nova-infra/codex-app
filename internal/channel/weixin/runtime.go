package weixin

import (
	"context"
	"fmt"
	"strings"

	"github.com/nova-infra/codex-app/internal/channelapi"
)

type RuntimeConfig struct {
	CorpID     string `json:"corp_id"`
	CorpSecret string `json:"corp_secret"`
	AgentID    string `json:"agent_id"`
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
	if strings.TrimSpace(msg.ChannelID) == "" {
		return fmt.Errorf("weixin runtime requires channel_id")
	}
	if strings.TrimSpace(msg.Text) == "" {
		return fmt.Errorf("weixin runtime requires non-empty text")
	}
	return nil
}

func (r *Runtime) GetUpdates(_ context.Context, limit int) ([]channelapi.RuntimeUpdate, error) {
	if limit < 0 {
		return nil, fmt.Errorf("weixin runtime limit must be >=0")
	}
	return nil, nil
}

func validate(cfg RuntimeConfig) error {
	if strings.TrimSpace(cfg.CorpID) == "" {
		return fmt.Errorf("weixin runtime requires corp_id")
	}
	if strings.TrimSpace(cfg.CorpSecret) == "" {
		return fmt.Errorf("weixin runtime requires corp_secret")
	}
	if strings.TrimSpace(cfg.AgentID) == "" {
		return fmt.Errorf("weixin runtime requires agent_id")
	}
	return nil
}
