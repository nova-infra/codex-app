package codex

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestExecResponderRespond(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell script fixture is unix-only")
	}
	dir := t.TempDir()
	bin := filepath.Join(dir, "codex")
	script := "#!/usr/bin/env sh\nout=\"\"\nprev=\"\"\nfor arg in \"$@\"; do\n  if [ \"$prev\" = \"-o\" ]; then out=\"$arg\"; fi\n  prev=\"$arg\"\ndone\necho 'progress noise'\nprintf '真实 Codex 回复\n' > \"$out\"\n"
	if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake codex: %v", err)
	}
	got, err := (ExecResponder{Executable: bin, Timeout: 5 * time.Second}).Respond(context.Background(), "hello")
	if err != nil {
		t.Fatalf("respond: %v", err)
	}
	if got != "真实 Codex 回复" {
		t.Fatalf("unexpected response: %q", got)
	}
}

func TestNewExecResponderFromEnv(t *testing.T) {
	t.Setenv("CODEX_EXECUTABLE", "/tmp/codex")
	t.Setenv("CODEX_EXEC_MODEL", "gpt-low")
	t.Setenv("CODEX_EXEC_WORKDIR", "/tmp/work")
	t.Setenv("CODEX_EXEC_TIMEOUT_SECONDS", "7")
	responder := NewExecResponderFromEnv()
	if responder.Executable != "/tmp/codex" || responder.Model != "gpt-low" || responder.WorkDir != "/tmp/work" {
		t.Fatalf("unexpected responder: %#v", responder)
	}
	if responder.Timeout != 7*time.Second {
		t.Fatalf("unexpected timeout: %s", responder.Timeout)
	}
}
