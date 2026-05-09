package server

import (
	"testing"

	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
)

func TestLarkWSMessageExtractsTextEvent(t *testing.T) {
	chatID := "oc_123"
	messageID := "om_123"
	msgType := "text"
	content := `{"text":"ping"}`
	senderType := "user"
	got, ok := larkWSMessage(&larkim.P2MessageReceiveV1{Event: &larkim.P2MessageReceiveV1Data{
		Sender:  &larkim.EventSender{SenderType: &senderType},
		Message: &larkim.EventMessage{ChatId: &chatID, MessageId: &messageID, MessageType: &msgType, Content: &content},
	}})
	if !ok {
		t.Fatal("expected ws message")
	}
	if got.ChatID != chatID || got.MessageID != messageID || got.Content != content {
		t.Fatalf("unexpected message: %#v", got)
	}
}

func TestLarkWSMessageIgnoresAppSender(t *testing.T) {
	chatID := "oc_123"
	messageID := "om_123"
	senderType := "app"
	_, ok := larkWSMessage(&larkim.P2MessageReceiveV1{Event: &larkim.P2MessageReceiveV1Data{
		Sender:  &larkim.EventSender{SenderType: &senderType},
		Message: &larkim.EventMessage{ChatId: &chatID, MessageId: &messageID},
	}})
	if ok {
		t.Fatal("expected app sender to be ignored")
	}
}
