package command

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/nova-infra/codex-app/internal/channel/weixin"
	"github.com/nova-infra/codex-app/internal/channelapi"
	"github.com/nova-infra/codex-app/internal/kernel"
)

func (r *Router) runWeixin(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("weixin requires a subcommand. e.g. weixin token or weixin send --user <userid> --text <text>\n\n%s", usage)
	}
	switch args[0] {
	case "token":
		return r.runWeixinToken(args[1:])
	case "qr":
		return r.runWeixinQR(args[1:])
	case "qr-wait":
		return r.runWeixinQRWait(args[1:])
	case "qr-confirm":
		return r.runWeixinQRConfirm(args[1:])
	case "qr-status":
		return r.runWeixinQRStatus(args[1:])
	case "updates":
		return r.runWeixinUpdates(args[1:])
	case "wait":
		return r.runWeixinWait(args[1:])
	case "send":
		return r.runWeixinSend(args[1:])
	default:
		return fmt.Errorf("unknown weixin subcommand %q\n\n%s", args[0], usage)
	}
}

func (r *Router) runWeixinQR(args []string) error {
	jsonMode, args := parseJSONCommand(args)
	fs := flag.NewFlagSet("weixin qr", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	baseURL := fs.String("base-url", "", "iLink API base URL")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("weixin qr does not accept positional arguments")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	qr, err := weixin.GetQRCode(ctx, *baseURL)
	if err != nil {
		return err
	}
	if jsonMode {
		return printJSON(r.out, map[string]any{"ok": true, "data": qr})
	}
	_, err = fmt.Fprintf(r.out, "qrcode: %s\nqrcode_url: %s\n", qr.QRCode, qr.QRCodeURL)
	return err
}

func (r *Router) runWeixinQRWait(args []string) error {
	jsonMode, args := parseJSONCommand(args)
	fs := flag.NewFlagSet("weixin qr-wait", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	baseURL := fs.String("base-url", "", "iLink API base URL")
	timeoutSeconds := fs.Int("timeout", 180, "seconds to wait for QR confirmation")
	writeEnv := fs.Bool("write-env", false, "write confirmed bot token to .env without printing it")
	envFile := fs.String("env-file", ".env", "env file path for --write-env")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("weixin qr-wait does not accept positional arguments")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(*timeoutSeconds)*time.Second)
	defer cancel()
	qrCtx, qrCancel := context.WithTimeout(ctx, 25*time.Second)
	qr, err := weixin.GetQRCode(qrCtx, *baseURL)
	qrCancel()
	if err != nil {
		return err
	}
	if !jsonMode {
		if _, err := fmt.Fprintf(r.out, "qrcode: %s\nqrcode_url: %s\n", qr.QRCode, qr.QRCodeURL); err != nil {
			return err
		}
	}
	result, err := waitWeixinQR(ctx, *baseURL, qr.QRCode, 3*time.Second)
	if err != nil {
		return err
	}
	envWritten := false
	if *writeEnv && result.token != "" {
		values := map[string]string{"WEIXIN_ILINK_BOT_TOKEN": result.token}
		if result.status.BaseURL != "" {
			values["WEIXIN_ILINK_BASE"] = result.status.BaseURL
		}
		if err := updateEnvFile(*envFile, values); err != nil {
			return err
		}
		envWritten = true
	}
	payload := map[string]any{
		"qrcode":        qr.QRCode,
		"qrcode_url":    qr.QRCodeURL,
		"status":        result.status.Status,
		"token_present": result.status.TokenPresent,
		"base_url":      result.status.BaseURL,
		"env_written":   envWritten,
	}
	if jsonMode {
		if err := printJSON(r.out, map[string]any{"ok": result.status.TokenPresent, "data": payload}); err != nil {
			return err
		}
		if !result.status.TokenPresent {
			return fmt.Errorf("weixin qr-wait ended with status %s", result.status.Status)
		}
		return nil
	}
	_, err = fmt.Fprintf(r.out, "status: %s\ntoken_present: %v\nenv_written: %v\n", result.status.Status, result.status.TokenPresent, envWritten)
	if err != nil {
		return err
	}
	if !result.status.TokenPresent {
		return fmt.Errorf("weixin qr-wait ended with status %s", result.status.Status)
	}
	return nil
}

func (r *Router) runWeixinQRConfirm(args []string) error {
	jsonMode, args := parseJSONCommand(args)
	fs := flag.NewFlagSet("weixin qr-confirm", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	baseURL := fs.String("base-url", "", "iLink API base URL")
	qrcode := fs.String("qrcode", "", "qrcode returned by weixin qr or release-unblock")
	timeoutSeconds := fs.Int("timeout", 180, "seconds to wait for QR confirmation")
	writeEnv := fs.Bool("write-env", false, "write confirmed bot token to .env without printing it")
	envFile := fs.String("env-file", ".env", "env file path for --write-env")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("weixin qr-confirm does not accept positional arguments")
	}
	if strings.TrimSpace(*qrcode) == "" {
		return errors.New("weixin qr-confirm requires --qrcode")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(*timeoutSeconds)*time.Second)
	defer cancel()
	result, err := waitWeixinQR(ctx, *baseURL, *qrcode, 3*time.Second)
	if err != nil {
		return err
	}
	envWritten := false
	if *writeEnv && result.token != "" {
		values := map[string]string{"WEIXIN_ILINK_BOT_TOKEN": result.token}
		if result.status.BaseURL != "" {
			values["WEIXIN_ILINK_BASE"] = result.status.BaseURL
		}
		if err := updateEnvFile(*envFile, values); err != nil {
			return err
		}
		envWritten = true
	}
	payload := map[string]any{
		"qrcode":        *qrcode,
		"status":        result.status.Status,
		"token_present": result.status.TokenPresent,
		"base_url":      result.status.BaseURL,
		"env_written":   envWritten,
	}
	if jsonMode {
		if err := printJSON(r.out, map[string]any{"ok": result.status.TokenPresent, "data": payload}); err != nil {
			return err
		}
		if !result.status.TokenPresent {
			return fmt.Errorf("weixin qr-confirm ended with status %s", result.status.Status)
		}
		return nil
	}
	_, err = fmt.Fprintf(r.out, "status: %s\ntoken_present: %v\nenv_written: %v\n", result.status.Status, result.status.TokenPresent, envWritten)
	if err != nil {
		return err
	}
	if !result.status.TokenPresent {
		return fmt.Errorf("weixin qr-confirm ended with status %s", result.status.Status)
	}
	return nil
}

type weixinQRWaitResult struct {
	status weixin.QRCodeStatus
	token  string
}

func waitWeixinQR(ctx context.Context, baseURL string, qrcode string, interval time.Duration) (weixinQRWaitResult, error) {
	if interval <= 0 {
		interval = 3 * time.Second
	}
	last := weixin.QRCodeStatus{Status: "pending"}
	for {
		statusCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
		status, token, err := weixin.GetQRCodeStatus(statusCtx, baseURL, qrcode)
		cancel()
		if err != nil {
			if ctx.Err() != nil {
				return weixinQRWaitResult{status: last}, nil
			}
			return weixinQRWaitResult{}, err
		}
		last = status
		if token != "" || status.Status == "confirmed" || status.Status == "expired" {
			return weixinQRWaitResult{status: status, token: token}, nil
		}
		select {
		case <-ctx.Done():
			return weixinQRWaitResult{status: status}, nil
		case <-time.After(interval):
		}
	}
}

func (r *Router) runWeixinQRStatus(args []string) error {
	jsonMode, args := parseJSONCommand(args)
	fs := flag.NewFlagSet("weixin qr-status", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	baseURL := fs.String("base-url", "", "iLink API base URL")
	qrcode := fs.String("qrcode", "", "qrcode returned by weixin qr")
	writeEnv := fs.Bool("write-env", false, "write confirmed bot token to .env without printing it")
	envFile := fs.String("env-file", ".env", "env file path for --write-env")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("weixin qr-status does not accept positional arguments")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	status, token, err := weixin.GetQRCodeStatus(ctx, *baseURL, *qrcode)
	if err != nil {
		return err
	}
	envWritten := false
	if *writeEnv && token != "" {
		values := map[string]string{"WEIXIN_ILINK_BOT_TOKEN": token}
		if status.BaseURL != "" {
			values["WEIXIN_ILINK_BASE"] = status.BaseURL
		}
		if err := updateEnvFile(*envFile, values); err != nil {
			return err
		}
		envWritten = true
	}
	if jsonMode {
		return printJSON(r.out, map[string]any{"ok": true, "data": map[string]any{
			"status":        status.Status,
			"token_present": status.TokenPresent,
			"base_url":      status.BaseURL,
			"env_written":   envWritten,
		}})
	}
	_, err = fmt.Fprintf(r.out, "status: %s\ntoken_present: %v\nenv_written: %v\n", status.Status, status.TokenPresent, envWritten)
	return err
}

func updateEnvFile(path string, values map[string]string) error {
	content := ""
	if body, err := os.ReadFile(path); err == nil {
		content = string(body)
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("read env file %q: %w", path, err)
	}
	lines := strings.Split(strings.TrimRight(content, "\n"), "\n")
	if len(lines) == 1 && lines[0] == "" {
		lines = nil
	}
	seen := map[string]bool{}
	for i, line := range lines {
		key, ok := envLineKey(line)
		if !ok {
			continue
		}
		if value, exists := values[key]; exists {
			lines[i] = key + "=" + envQuote(value)
			seen[key] = true
		}
	}
	for key, value := range values {
		if !seen[key] {
			lines = append(lines, key+"="+envQuote(value))
		}
	}
	return os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o600)
}

func envLineKey(line string) (string, bool) {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" || strings.HasPrefix(trimmed, "#") {
		return "", false
	}
	parts := strings.SplitN(trimmed, "=", 2)
	if len(parts) != 2 {
		return "", false
	}
	key := strings.TrimSpace(parts[0])
	return key, key != ""
}

func envQuote(value string) string {
	escaped := strings.ReplaceAll(value, "\\", "\\\\")
	escaped = strings.ReplaceAll(escaped, "\"", "\\\"")
	return "\"" + escaped + "\""
}

func (r *Router) runWeixinUpdates(args []string) error {
	jsonMode, args := parseJSONCommand(args)
	fs := flag.NewFlagSet("weixin updates", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	limit := fs.Int("limit", 10, "max updates to fetch")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("weixin updates does not accept positional arguments")
	}
	runtime, err := weixin.NewRuntimeFromEnv()
	if err != nil {
		return err
	}
	updates, err := runtime.GetUpdates(context.Background(), *limit)
	if err != nil {
		return err
	}
	if jsonMode {
		return printJSON(r.out, map[string]any{"ok": true, "data": updates})
	}
	for _, update := range updates {
		if _, err := fmt.Fprintln(r.out, strconv.FormatInt(update.UpdateID, 10)+" "+update.ChannelID+" "+update.Payload); err != nil {
			return err
		}
	}
	return nil
}

func (r *Router) runWeixinWait(args []string) error {
	jsonMode, args := parseJSONCommand(args)
	fs := flag.NewFlagSet("weixin wait", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	timeoutSeconds := fs.Int("timeout", 120, "seconds to wait for first Weixin iLink message")
	reply := fs.Bool("reply", false, "send a low-noise reply to the first inbound message")
	writeE2E := fs.Bool("write-e2e", false, "write successful inbound/approval E2E evidence to .env")
	untilApproval := fs.Bool("until-approval", false, "continue waiting until an approval confirm/reject is observed")
	envFile := fs.String("env-file", ".env", "env file path for --write-e2e")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("weixin wait does not accept positional arguments")
	}
	runtime, err := weixin.NewRuntimeFromEnv()
	if err != nil {
		return err
	}
	deadline := time.Now().Add(time.Duration(*timeoutSeconds) * time.Second)
	cursor := ""
	inboundSeen := false
	lastPayload := map[string]any{}
	for time.Now().Before(deadline) {
		remaining := time.Until(deadline)
		pollTimeoutMs := 38000
		if remaining < 38*time.Second {
			pollTimeoutMs = int(remaining.Milliseconds())
			if pollTimeoutMs <= 0 {
				pollTimeoutMs = 1000
			}
		}
		ctx, cancel := context.WithTimeout(context.Background(), time.Duration(pollTimeoutMs+3000)*time.Millisecond)
		page, err := runtime.GetUpdatesPage(ctx, cursor, 10, pollTimeoutMs)
		cancel()
		if err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				if !time.Now().Before(deadline) {
					break
				}
				continue
			}
			return err
		}
		if next := strings.TrimSpace(page.Cursor); next != "" {
			cursor = next
		}
		updates := page.Updates
		for _, update := range updates {
			if next := strings.TrimSpace(update.Metadata["cursor"]); next != "" {
				cursor = next
			}
			if strings.TrimSpace(update.ChannelID) == "" {
				continue
			}
			replied := false
			replyText := ""
			if *reply {
				replyText = kernel.HandleIncomingMessage(kernel.IncomingMessage{
					Channel:   "wechat",
					ChatID:    update.ChannelID,
					MessageID: strconv.FormatInt(update.UpdateID, 10),
					Text:      update.Payload,
				})
				if err := runtime.Send(context.Background(), channelapi.RuntimeMessage{
					ChannelID: update.ChannelID,
					Text:      replyText,
					Metadata:  update.Metadata,
				}); err != nil {
					return err
				}
				replied = true
			}
			e2eWritten := false
			if *writeE2E {
				values := map[string]string{"CODEX_APP_E2E_WEIXIN_INBOUND": "true"}
				if isApprovalResolvedReply(replyText) {
					values["CODEX_APP_E2E_APPROVAL_REAL"] = "true"
				}
				if err := updateEnvFile(*envFile, values); err != nil {
					return err
				}
				e2eWritten = true
			}
			approvalResolved := isApprovalResolvedReply(replyText)
			inboundSeen = true
			lastPayload = map[string]any{
				"channel_id":        update.ChannelID,
				"update_id":         update.UpdateID,
				"text":              update.Payload,
				"reply_text":        replyText,
				"replied":           replied,
				"e2e_written":       e2eWritten,
				"approval_resolved": approvalResolved,
			}
			if *untilApproval && !approvalResolved {
				continue
			}
			if jsonMode {
				return printJSON(r.out, map[string]any{"ok": true, "data": lastPayload})
			}
			_, err := fmt.Fprintf(r.out, "%d\t%s\t%s\nreplied: %v\ne2e_written: %v\n", update.UpdateID, update.ChannelID, update.Payload, replied, e2eWritten)
			return err
		}
	}
	if *untilApproval && inboundSeen {
		if jsonMode {
			if err := printJSON(r.out, map[string]any{"ok": false, "error": "weixin approval wait timed out", "data": lastPayload}); err != nil {
				return err
			}
			return fmt.Errorf("weixin approval wait timed out after %d seconds", *timeoutSeconds)
		}
		return fmt.Errorf("weixin approval wait timed out after %d seconds", *timeoutSeconds)
	}
	if jsonMode {
		if err := printJSON(r.out, map[string]any{"ok": false, "error": "weixin wait timed out"}); err != nil {
			return err
		}
		return fmt.Errorf("weixin wait timed out after %d seconds", *timeoutSeconds)
	}
	return fmt.Errorf("weixin wait timed out after %d seconds", *timeoutSeconds)
}

func isApprovalResolvedReply(text string) bool {
	return strings.Contains(text, ": confirm") || strings.Contains(text, ": reject")
}

func (r *Router) runWeixinToken(args []string) error {
	jsonMode, args := parseJSONCommand(args)
	fs := flag.NewFlagSet("weixin token", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("weixin token does not accept positional arguments")
	}
	runtime, err := weixin.NewRuntimeFromEnv()
	if err != nil {
		return err
	}
	token, err := runtime.AccessToken(context.Background())
	if err != nil {
		return err
	}
	if jsonMode {
		return printJSON(r.out, map[string]any{"ok": true, "data": map[string]any{"token_present": token != ""}})
	}
	_, err = fmt.Fprintln(r.out, "weixin token: ok")
	return err
}

func (r *Router) runWeixinSend(args []string) error {
	jsonMode, args := parseJSONCommand(args)
	fs := flag.NewFlagSet("weixin send", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	userID := fs.String("user", "", "Weixin userid")
	text := fs.String("text", "", "text to send")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("weixin send does not accept positional arguments")
	}
	runtime, err := weixin.NewRuntimeFromEnv()
	if err != nil {
		return err
	}
	if err := runtime.Send(context.Background(), channelapi.RuntimeMessage{ChannelID: *userID, Text: *text}); err != nil {
		return err
	}
	if jsonMode {
		return printJSON(r.out, map[string]any{"ok": true})
	}
	_, err = fmt.Fprintln(r.out, "weixin send: ok")
	return err
}
