package codex

import (
	"fmt"

	"github.com/nova-infra/codex-app/internal/project"
	"github.com/nova-infra/codex-app/internal/provider"
	"github.com/nova-infra/codex-app/internal/session"
)

type Session struct {
	Project     project.Config
	Provider    provider.Config
	Runtime     session.RuntimeSessionConfig
	Initialized bool
}

func NewSession(p project.Config, providerCfg provider.Config) (*Session, error) {
	if err := p.Validate(); err != nil {
		return nil, fmt.Errorf("project validation failed: %w", err)
	}
	if err := providerCfg.Validate(); err != nil {
		return nil, fmt.Errorf("provider validation failed: %w", err)
	}

	rt, err := session.DefaultSessionConfig(p)
	if err != nil {
		return nil, err
	}

	return &Session{
		Project:     p,
		Provider:    providerCfg,
		Runtime:     rt,
		Initialized: true,
	}, nil
}

func (s *Session) Validate() error {
	if s == nil || !s.Initialized {
		return fmt.Errorf("session is not initialized")
	}
	if s.Project.Name != s.Runtime.ProjectName {
		return fmt.Errorf("session project mismatch")
	}
	return nil
}
