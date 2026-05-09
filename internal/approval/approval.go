package approval

import (
	"fmt"
	"strings"
	"time"
)

type Decision string

const (
	DecisionPending Decision = "pending"
	DecisionConfirm Decision = "confirm"
	DecisionReject  Decision = "reject"
	DecisionExpired Decision = "expired"
)

const DefaultTimeout = 10 * time.Minute

type Request struct {
	ID        string
	CreatedAt time.Time
	Timeout   time.Duration
}

type Result struct {
	RequestID string
	Decision  Decision
	ExpiredAt time.Time
}

func Resolve(req Request, input string, now time.Time) (Result, error) {
	if strings.TrimSpace(req.ID) == "" {
		return Result{}, fmt.Errorf("approval request id is required")
	}
	timeout := req.Timeout
	if timeout <= 0 {
		timeout = DefaultTimeout
	}
	expiresAt := req.CreatedAt.Add(timeout)
	if !now.Before(expiresAt) {
		return Result{RequestID: req.ID, Decision: DecisionExpired, ExpiredAt: expiresAt}, nil
	}
	switch normalizeInput(input) {
	case "1", "y", "yes", "ok", "confirm", "approve", "确认", "同意":
		return Result{RequestID: req.ID, Decision: DecisionConfirm, ExpiredAt: expiresAt}, nil
	case "2", "n", "no", "reject", "deny", "拒绝", "取消":
		return Result{RequestID: req.ID, Decision: DecisionReject, ExpiredAt: expiresAt}, nil
	case "":
		return Result{RequestID: req.ID, Decision: DecisionPending, ExpiredAt: expiresAt}, nil
	default:
		return Result{}, fmt.Errorf("invalid approval input %q", input)
	}
}

func normalizeInput(input string) string {
	return strings.ToLower(strings.TrimSpace(input))
}
