package kernel

import (
	"strings"
	"testing"
)

func TestHandleIncomingApprovalDemoConfirm(t *testing.T) {
	resetApprovalsForTest()
	msg := IncomingMessage{Channel: "wechat", ChatID: "chat-1", MessageID: "msg-1", Text: "/approval-demo"}
	created := HandleIncomingMessage(msg)
	if !strings.Contains(created, "approval-msg-1") {
		t.Fatalf("created text = %q", created)
	}
	confirmed := HandleIncomingMessage(IncomingMessage{Channel: "wechat", ChatID: "chat-1", MessageID: "msg-2", Text: "1"})
	if !strings.Contains(confirmed, "approval approval-msg-1: confirm") {
		t.Fatalf("confirmed text = %q", confirmed)
	}
}

func TestHandleIncomingApprovalRejectCommand(t *testing.T) {
	resetApprovalsForTest()
	_ = HandleIncomingMessage(IncomingMessage{Channel: "telegram", ChatID: "chat-1", MessageID: "msg-1", Text: "/approval-demo"})
	rejected := HandleIncomingMessage(IncomingMessage{Channel: "telegram", ChatID: "chat-1", MessageID: "msg-2", Text: "/reject"})
	if !strings.Contains(rejected, "approval approval-msg-1: reject") {
		t.Fatalf("rejected text = %q", rejected)
	}
}

func TestHandleIncomingApprovalExplicitRequestID(t *testing.T) {
	resetApprovalsForTest()
	_ = HandleIncomingMessage(IncomingMessage{Channel: "lark", ChatID: "chat-1", MessageID: "msg-1", Text: "/approval-demo"})
	confirmed := HandleIncomingMessage(IncomingMessage{Channel: "lark", ChatID: "other-chat", MessageID: "msg-2", Text: "/approve approval-msg-1"})
	if !strings.Contains(confirmed, "approval approval-msg-1: confirm") {
		t.Fatalf("confirmed text = %q", confirmed)
	}
}

func resetApprovalsForTest() {
	approvals.Lock()
	defer approvals.Unlock()
	approvals.byChat = map[string]pendingApproval{}
}
