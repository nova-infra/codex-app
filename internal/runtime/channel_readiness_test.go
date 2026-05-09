package runtime

import "testing"

func TestMissingChannelEnv(t *testing.T) {
	t.Setenv("TELEGRAM_BOT_TOKEN", "")
	missing := MissingChannelEnv("telegram")
	if len(missing) != 1 || missing[0] != "TELEGRAM_BOT_TOKEN" {
		t.Fatalf("unexpected missing env: %v", missing)
	}
}

func TestChannelCredentialChecksWarn(t *testing.T) {
	checks := ChannelCredentialChecks([]string{"telegram"})
	if len(checks) != 1 || checks[0].Status != CheckWarn {
		t.Fatalf("expected warning check, got %#v", checks)
	}
}
