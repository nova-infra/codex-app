package kernel

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/nova-infra/codex-app/internal/approval"
)

type IncomingMessage struct {
	Channel   string
	ChatID    string
	MessageID string
	Text      string
}

func HandleIncomingMessage(msg IncomingMessage) string {
	text := strings.TrimSpace(msg.Text)
	if text == "" {
		return "我收到了空消息。"
	}
	if reply, ok := handleApprovalInput(msg, text, time.Now()); ok {
		return reply
	}
	if strings.HasPrefix(text, "/") {
		return handleCommand(msg, text)
	}
	return fmt.Sprintf("Codex App 已收到你的消息：%s\n\n当前 Go/Lark 链路已接入 WebSocket、原生 reply 和服务路由。下一步可接真实 Codex session。", text)
}

func handleCommand(msg IncomingMessage, text string) string {
	fields := strings.Fields(text)
	switch fields[0] {
	case "/approval-demo":
		return createApprovalDemo(msg, time.Now())
	case "/ping":
		return "pong"
	case "/time":
		return time.Now().Format(time.RFC3339)
	case "/help":
		return "可用命令：/ping、/time、/help、/approval-demo、/approve [request_id]、/reject [request_id]。微信可直接回复 1 确认，2 拒绝。"
	default:
		return "未知命令。可用命令：/ping、/time、/help、/approval-demo、/approve [request_id]、/reject [request_id]。"
	}
}

type pendingApproval struct {
	request approval.Request
}

var approvals = struct {
	sync.Mutex
	byChat map[string]pendingApproval
}{byChat: map[string]pendingApproval{}}

func createApprovalDemo(msg IncomingMessage, now time.Time) string {
	requestID := "approval-" + safeID(msg.MessageID, fmt.Sprintf("%d", now.Unix()))
	req := approval.Request{ID: requestID, CreatedAt: now}
	approvals.Lock()
	approvals.byChat[approvalChatKey(msg)] = pendingApproval{request: req}
	approvals.Unlock()
	return fmt.Sprintf("approval 请求已创建：%s\n回复 /approve 或 1 确认；回复 /reject 或 2 拒绝。", requestID)
}

func handleApprovalInput(msg IncomingMessage, text string, now time.Time) (string, bool) {
	input, requestID, ok := parseApprovalInput(text)
	if !ok {
		return "", false
	}
	req, found := findApprovalRequest(msg, requestID)
	if !found {
		return "没有找到待处理 approval。请先发送 /approval-demo，或使用 /approve <request_id>。", true
	}
	result, err := approval.Resolve(req, input, now)
	if err != nil {
		return err.Error(), true
	}
	if result.Decision == approval.DecisionConfirm || result.Decision == approval.DecisionReject || result.Decision == approval.DecisionExpired {
		clearApproval(msg, req.ID)
	}
	return fmt.Sprintf("approval %s: %s", result.RequestID, result.Decision), true
}

func parseApprovalInput(text string) (input string, requestID string, ok bool) {
	fields := strings.Fields(strings.TrimSpace(text))
	if len(fields) == 0 {
		return "", "", false
	}
	switch fields[0] {
	case "/approve", "/confirm":
		return "confirm", secondField(fields), true
	case "/reject", "/deny":
		return "reject", secondField(fields), true
	case "1", "2", "确认", "同意", "拒绝", "取消":
		return fields[0], secondField(fields), true
	default:
		return "", "", false
	}
}

func secondField(fields []string) string {
	if len(fields) < 2 {
		return ""
	}
	return fields[1]
}

func findApprovalRequest(msg IncomingMessage, requestID string) (approval.Request, bool) {
	key := approvalChatKey(msg)
	approvals.Lock()
	defer approvals.Unlock()
	if requestID != "" {
		for _, pending := range approvals.byChat {
			if pending.request.ID == requestID {
				return pending.request, true
			}
		}
		return approval.Request{}, false
	}
	pending, ok := approvals.byChat[key]
	return pending.request, ok
}

func clearApproval(msg IncomingMessage, requestID string) {
	key := approvalChatKey(msg)
	approvals.Lock()
	defer approvals.Unlock()
	if pending, ok := approvals.byChat[key]; ok && pending.request.ID == requestID {
		delete(approvals.byChat, key)
		return
	}
	for chatKey, pending := range approvals.byChat {
		if pending.request.ID == requestID {
			delete(approvals.byChat, chatKey)
			return
		}
	}
}

func approvalChatKey(msg IncomingMessage) string {
	return strings.TrimSpace(msg.Channel) + ":" + strings.TrimSpace(msg.ChatID)
}

func safeID(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	replacer := strings.NewReplacer(" ", "-", "\t", "-", "\n", "-", "/", "-", "\\", "-")
	return replacer.Replace(value)
}
