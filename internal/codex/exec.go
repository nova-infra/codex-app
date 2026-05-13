package codex

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

type ExecResponder struct {
	Executable string
	Model      string
	WorkDir    string
	Timeout    time.Duration
}

func NewExecResponderFromEnv() ExecResponder {
	return ExecResponder{
		Executable: os.Getenv("CODEX_EXECUTABLE"),
		Model:      os.Getenv("CODEX_EXEC_MODEL"),
		WorkDir:    os.Getenv("CODEX_EXEC_WORKDIR"),
		Timeout:    timeoutFromEnv(os.Getenv("CODEX_EXEC_TIMEOUT_SECONDS")),
	}
}

func (r ExecResponder) Respond(ctx context.Context, userText string) (string, error) {
	return r.StreamRespond(ctx, userText, nil)
}

func (r ExecResponder) StreamRespond(ctx context.Context, userText string, onDelta func(string)) (string, error) {
	text := strings.TrimSpace(userText)
	if text == "" {
		return "", fmt.Errorf("codex prompt is empty")
	}
	ctx, cancel := context.WithTimeout(ctx, r.timeout())
	defer cancel()
	outputPath, cleanup, err := prepareOutputFile()
	if err != nil {
		return "", err
	}
	defer cleanup()
	out, err := r.run(ctx, outputPath, text)
	if ctx.Err() != nil {
		return "", fmt.Errorf("codex response timeout: %w", ctx.Err())
	}
	if err != nil {
		return "", fmt.Errorf("codex exec failed: %w: %s", err, trimOutput(out))
	}
	answer, err := readCodexAnswer(outputPath, out)
	if err != nil {
		return "", err
	}
	if onDelta != nil && answer != "" {
		onDelta(answer)
	}
	return answer, nil
}

func (r ExecResponder) run(ctx context.Context, outputPath string, text string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, r.executable(), r.args(outputPath, text)...)
	if workDir := strings.TrimSpace(r.WorkDir); workDir != "" {
		cmd.Dir = workDir
	}
	return cmd.CombinedOutput()
}

func (r ExecResponder) args(outputPath string, text string) []string {
	args := []string{"exec", "--ephemeral", "--skip-git-repo-check", "-s", "read-only", "-o", outputPath}
	if model := strings.TrimSpace(r.Model); model != "" {
		args = append(args, "-m", model)
	}
	return append(args, buildPrompt(text))
}

func (r ExecResponder) executable() string {
	if executable := strings.TrimSpace(r.Executable); executable != "" {
		return executable
	}
	return "codex"
}

func (r ExecResponder) timeout() time.Duration {
	if r.Timeout > 0 {
		return r.Timeout
	}
	return 90 * time.Second
}

func timeoutFromEnv(value string) time.Duration {
	seconds, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || seconds <= 0 {
		return 0
	}
	return time.Duration(seconds) * time.Second
}

func prepareOutputFile() (string, func(), error) {
	outputFile, err := os.CreateTemp("", "codex-app-lark-*.txt")
	if err != nil {
		return "", func() {}, fmt.Errorf("create codex output file: %w", err)
	}
	path := outputFile.Name()
	if err := outputFile.Close(); err != nil {
		_ = os.Remove(path)
		return "", func() {}, fmt.Errorf("close codex output file: %w", err)
	}
	return path, func() { _ = os.Remove(path) }, nil
}

func readCodexAnswer(path string, fallback []byte) (string, error) {
	answer, err := readAnswer(path)
	if err != nil {
		return "", err
	}
	if answer == "" {
		answer = trimOutput(fallback)
	}
	if answer == "" {
		return "", fmt.Errorf("codex exec returned empty response")
	}
	return answer, nil
}

func readAnswer(path string) (string, error) {
	out, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read codex output file: %w", err)
	}
	return strings.TrimSpace(string(out)), nil
}

func buildPrompt(userText string) string {
	return "你是 codex-app 的 Lark 助手。请用中文简洁回答用户，不要复述原文，不要执行命令。用户消息：\n" + userText
}

func trimOutput(out []byte) string {
	text := strings.TrimSpace(string(out))
	lines := strings.Split(text, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line != "" {
			return line
		}
	}
	return ""
}
