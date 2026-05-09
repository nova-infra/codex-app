package command

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/nova-infra/codex-app/internal/channel"
	"github.com/nova-infra/codex-app/internal/channel/lark"
	"github.com/nova-infra/codex-app/internal/channel/telegram"
	"github.com/nova-infra/codex-app/internal/channel/weixin"
	"github.com/nova-infra/codex-app/internal/channelapi"
	"github.com/nova-infra/codex-app/internal/config"
	"github.com/nova-infra/codex-app/internal/kernel"
	"github.com/nova-infra/codex-app/internal/render"
	"github.com/nova-infra/codex-app/internal/server"
)

type releaseCheck struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
}

func (r *Router) runReleaseCheck(args []string) error {
	jsonMode, args := parseJSONCommand(args)
	fs := flag.NewFlagSet("release-check", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	configPath := fs.String("config", "", "path to JSON config")
	smoke := fs.Bool("smoke", false, "run lightweight real platform smoke checks when possible")
	requireE2E := fs.Bool("require-e2e", false, "require manually recorded real inbound/approval E2E evidence")
	strictExit := fs.Bool("strict-exit", false, "return a non-zero exit code when checks are not ok, including JSON mode")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("release-check does not accept positional arguments")
	}
	checks := runReleaseChecks(*configPath, *smoke, *requireE2E)
	ok := releaseChecksOK(checks)
	if jsonMode {
		if err := printJSON(r.out, map[string]any{"ok": ok, "data": checks}); err != nil {
			return err
		}
		if *strictExit && !ok {
			return errors.New("release-check blocked")
		}
		return nil
	}
	if ok {
		if _, err := fmt.Fprintln(r.out, "release-check: ok"); err != nil {
			return err
		}
	}
	for _, check := range checks {
		if _, err := fmt.Fprintf(r.out, "- %s: %s", check.Name, check.Status); err != nil {
			return err
		}
		if check.Detail != "" {
			if _, err := fmt.Fprintf(r.out, " (%s)", check.Detail); err != nil {
				return err
			}
		}
		if _, err := fmt.Fprintln(r.out); err != nil {
			return err
		}
	}
	if !ok {
		return errors.New("release-check blocked")
	}
	return nil
}

func runReleaseChecks(configPath string, smoke bool, requireE2E bool) []releaseCheck {
	checks := []releaseCheck{}
	if _, err := config.Load(configPath); err != nil {
		checks = append(checks, releaseCheck{Name: "config", Status: "fail", Detail: err.Error()})
	} else {
		checks = append(checks, releaseCheck{Name: "config", Status: "ok", Detail: "config valid"})
	}
	checks = append(checks, checkApprovalRender())
	checks = append(checks, checkApprovalInput())
	checks = append(checks, checkLarkRelease())
	checks = append(checks, checkTelegramRelease(smoke)...)
	checks = append(checks, checkWeixinRelease(smoke)...)
	if smoke {
		checks = append(checks, checkServiceHealth(configPath))
	}
	if requireE2E {
		checks = append(checks, checkE2EEvidence()...)
	}
	return checks
}

func releaseChecksOK(checks []releaseCheck) bool {
	for _, check := range checks {
		if check.Status == "fail" || check.Status == "blocked" {
			return false
		}
	}
	return true
}

func checkApprovalRender() releaseCheck {
	messages, err := channel.RenderDemo("all")
	if err != nil {
		return releaseCheck{Name: "approval.render", Status: "fail", Detail: err.Error()}
	}
	required := map[render.Channel]string{
		render.ChannelTelegram: "inline_approval",
		render.ChannelWeixin:   "approval_menu",
		render.ChannelLark:     "card_approval",
	}
	for ch, blockType := range required {
		if !hasApprovalBlock(messages, ch, blockType) {
			return releaseCheck{Name: "approval.render", Status: "fail", Detail: fmt.Sprintf("missing %s for %s", blockType, ch)}
		}
	}
	return releaseCheck{Name: "approval.render", Status: "ok", Detail: "telegram/weixin/lark approval render contracts valid"}
}

func checkApprovalInput() releaseCheck {
	created := kernel.HandleIncomingMessage(kernel.IncomingMessage{Channel: "release", ChatID: "approval", MessageID: "release-check", Text: "/approval-demo"})
	if !strings.Contains(created, "approval-release-check") {
		return releaseCheck{Name: "approval.input", Status: "fail", Detail: "demo approval was not created"}
	}
	confirmed := kernel.HandleIncomingMessage(kernel.IncomingMessage{Channel: "release", ChatID: "approval", MessageID: "release-check-2", Text: "1"})
	if !strings.Contains(confirmed, "approval approval-release-check: confirm") {
		return releaseCheck{Name: "approval.input", Status: "fail", Detail: "numeric confirm did not resolve"}
	}
	_ = kernel.HandleIncomingMessage(kernel.IncomingMessage{Channel: "release", ChatID: "approval", MessageID: "release-check-3", Text: "/approval-demo"})
	rejected := kernel.HandleIncomingMessage(kernel.IncomingMessage{Channel: "release", ChatID: "approval", MessageID: "release-check-4", Text: "/reject"})
	if !strings.Contains(rejected, "approval approval-release-check-3: reject") {
		return releaseCheck{Name: "approval.input", Status: "fail", Detail: "command reject did not resolve"}
	}
	return releaseCheck{Name: "approval.input", Status: "ok", Detail: "numeric and command approval inputs valid"}
}

func hasApprovalBlock(messages []render.PlatformMessage, ch render.Channel, blockType string) bool {
	for _, message := range messages {
		if message.Channel != ch {
			continue
		}
		for _, block := range message.Blocks {
			if block.Type != blockType {
				continue
			}
			if strings.TrimSpace(block.Metadata["request_id"]) == "" {
				continue
			}
			if hasApprovalActionMetadata(block.Metadata) {
				return true
			}
		}
	}
	return false
}

func hasApprovalActionMetadata(metadata map[string]string) bool {
	if metadata["confirm_action"] == "confirm" && metadata["reject_action"] == "reject" {
		return true
	}
	return metadata["confirm_input"] == "1" && metadata["reject_input"] == "2"
}

func checkLarkRelease() releaseCheck {
	if missing := missingEnv("LARK_APP_ID", "LARK_APP_SECRET"); len(missing) > 0 {
		return releaseCheck{Name: "lark.credentials", Status: "blocked", Detail: "missing " + strings.Join(missing, ",")}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	rt, err := lark.NewRuntimeFromEnv()
	if err != nil {
		return releaseCheck{Name: "lark.token", Status: "fail", Detail: err.Error()}
	}
	if _, err := rt.TenantAccessToken(ctx); err != nil {
		return releaseCheck{Name: "lark.token", Status: "fail", Detail: err.Error()}
	}
	return releaseCheck{Name: "lark.token", Status: "ok", Detail: "token valid"}
}

func checkTelegramRelease(smoke bool) []releaseCheck {
	if missing := missingEnv("TELEGRAM_BOT_TOKEN"); len(missing) > 0 {
		return []releaseCheck{{Name: "telegram.credentials", Status: "blocked", Detail: "missing TELEGRAM_BOT_TOKEN"}}
	}
	checks := []releaseCheck{}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	rt, err := telegram.NewRuntimeFromEnv()
	if err != nil {
		checks = append(checks, releaseCheck{Name: "telegram.token", Status: "fail", Detail: err.Error()})
	} else if me, err := rt.GetMeInfo(ctx); err != nil {
		checks = append(checks, releaseCheck{Name: "telegram.token", Status: "fail", Detail: err.Error()})
	} else {
		checks = append(checks, releaseCheck{Name: "telegram.token", Status: "ok", Detail: "@" + me.Username})
	}
	chatID := strings.TrimSpace(os.Getenv("TELEGRAM_CHAT_ID"))
	if chatID == "" {
		checks = append(checks, releaseCheck{Name: "telegram.chat", Status: "blocked", Detail: "send a message to the bot, then run telegram wait --write-env"})
	} else {
		checks = append(checks, releaseCheck{Name: "telegram.chat", Status: "ok", Detail: "chat id present"})
		if smoke {
			checks = append(checks, checkTelegramSmoke(rt, chatID))
		} else {
			checks = append(checks, releaseCheck{Name: "telegram.smoke", Status: "blocked", Detail: "not run; pass --smoke to send a real test message"})
		}
	}
	return checks
}

func checkTelegramSmoke(rt *telegram.Runtime, chatID string) releaseCheck {
	if rt == nil {
		return releaseCheck{Name: "telegram.smoke", Status: "blocked", Detail: "telegram runtime unavailable"}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := rt.Send(ctx, channelapiMessage(chatID, "codex-app Telegram release smoke ok")); err != nil {
		return releaseCheck{Name: "telegram.smoke", Status: "fail", Detail: err.Error()}
	}
	return releaseCheck{Name: "telegram.smoke", Status: "ok", Detail: "message sent"}
}

func checkWeixinRelease(smoke bool) []releaseCheck {
	checks := []releaseCheck{}
	if strings.TrimSpace(os.Getenv("WEIXIN_ILINK_BOT_TOKEN")) != "" || strings.TrimSpace(os.Getenv("WEIXIN_BOT_TOKEN")) != "" {
		checks = append(checks, releaseCheck{Name: "weixin.ilink", Status: "ok", Detail: "bot token present"})
		if smoke {
			checks = append(checks, checkWeixinSmoke())
		} else {
			checks = append(checks, releaseCheck{Name: "weixin.smoke", Status: "blocked", Detail: "not run; pass --smoke to call iLink getupdates"})
		}
	} else {
		checks = append(checks, releaseCheck{Name: "weixin.ilink", Status: "blocked", Detail: "scan QR, then run weixin qr-confirm --write-env"})
	}
	if missing := missingEnv("WEIXIN_CORP_ID", "WEIXIN_CORP_SECRET", "WEIXIN_AGENT_ID"); len(missing) == 0 {
		checks = append(checks, releaseCheck{Name: "weixin.corp", Status: "ok", Detail: "corp credentials present"})
	} else {
		checks = append(checks, releaseCheck{Name: "weixin.corp", Status: "warn", Detail: "optional corp send path missing " + strings.Join(missing, ",")})
	}
	return checks
}

func checkWeixinSmoke() releaseCheck {
	rt, err := weixin.NewRuntimeFromEnv()
	if err != nil {
		return releaseCheck{Name: "weixin.smoke", Status: "fail", Detail: err.Error()}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	if _, err := rt.GetUpdates(ctx, 1); err != nil {
		return releaseCheck{Name: "weixin.smoke", Status: "fail", Detail: err.Error()}
	}
	return releaseCheck{Name: "weixin.smoke", Status: "ok", Detail: "getupdates reachable"}
}

func checkServiceHealth(configPath string) releaseCheck {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ready := make(chan string, 1)
	errc := make(chan error, 1)
	go func() {
		_, err := server.StartContext(ctx, server.ServeOptions{ConfigPath: configPath, Addr: "127.0.0.1:0", Ready: ready})
		errc <- err
	}()
	addr, err := waitServiceReady(ready, errc)
	if err != nil {
		return releaseCheck{Name: "service.health", Status: "fail", Detail: err.Error()}
	}
	detail, err := waitServiceRunning(ctx, addr)
	cancel()
	if stopErr := waitServiceStopped(errc); stopErr != nil && err == nil {
		err = stopErr
	}
	if err != nil {
		return releaseCheck{Name: "service.health", Status: "fail", Detail: err.Error()}
	}
	return releaseCheck{Name: "service.health", Status: "ok", Detail: detail}
}

func checkE2EEvidence() []releaseCheck {
	return []releaseCheck{
		{Name: "telegram.inbound_e2e", Status: envEvidenceStatus("CODEX_APP_E2E_TELEGRAM_INBOUND"), Detail: envEvidenceDetail("CODEX_APP_E2E_TELEGRAM_INBOUND", "set after telegram message received/replied log is observed")},
		{Name: "weixin.inbound_e2e", Status: envEvidenceStatus("CODEX_APP_E2E_WEIXIN_INBOUND"), Detail: envEvidenceDetail("CODEX_APP_E2E_WEIXIN_INBOUND", "set after weixin wait --reply succeeds")},
		{Name: "approval.real_e2e", Status: envEvidenceStatus("CODEX_APP_E2E_APPROVAL_REAL"), Detail: envEvidenceDetail("CODEX_APP_E2E_APPROVAL_REAL", "set after /approval-demo and confirm/reject succeed on a real platform")},
	}
}

func envEvidenceStatus(key string) string {
	if strings.EqualFold(strings.TrimSpace(os.Getenv(key)), "true") {
		return "ok"
	}
	return "blocked"
}

func envEvidenceDetail(key string, missing string) string {
	if strings.EqualFold(strings.TrimSpace(os.Getenv(key)), "true") {
		return key + "=true"
	}
	return missing
}

func waitServiceReady(ready <-chan string, errc <-chan error) (string, error) {
	select {
	case addr := <-ready:
		return addr, nil
	case err := <-errc:
		if err == nil {
			return "", errors.New("service stopped before ready")
		}
		return "", err
	case <-time.After(10 * time.Second):
		return "", errors.New("service did not become ready")
	}
}

func waitServiceRunning(ctx context.Context, addr string) (string, error) {
	deadline := time.Now().Add(10 * time.Second)
	var last string
	for time.Now().Before(deadline) {
		payload, err := readServiceHealth(ctx, addr)
		if err != nil {
			last = err.Error()
			time.Sleep(250 * time.Millisecond)
			continue
		}
		data, _ := payload["data"].(map[string]any)
		if data["lark_ws_status"] == "connected" && data["telegram_polling_status"] == "running" && data["weixin_polling_status"] == "running" {
			return "lark_ws=connected telegram_polling=running weixin_polling=running", nil
		}
		last = fmt.Sprintf("lark_ws=%v telegram_polling=%v weixin_polling=%v", data["lark_ws_status"], data["telegram_polling_status"], data["weixin_polling_status"])
		time.Sleep(250 * time.Millisecond)
	}
	return "", fmt.Errorf("service health not running: %s", last)
}

func readServiceHealth(ctx context.Context, addr string) (map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+addr+"/health", nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("health status %d", resp.StatusCode)
	}
	var payload map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	if payload["ok"] != true {
		return nil, fmt.Errorf("health not ok: %#v", payload)
	}
	return payload, nil
}

func waitServiceStopped(errc <-chan error) error {
	select {
	case err := <-errc:
		return err
	case <-time.After(5 * time.Second):
		return errors.New("service did not stop")
	}
}

func channelapiMessage(channelID string, text string) channelapi.RuntimeMessage {
	return channelapi.RuntimeMessage{ChannelID: channelID, Text: text}
}

func missingEnv(keys ...string) []string {
	missing := []string{}
	for _, key := range keys {
		if strings.TrimSpace(os.Getenv(key)) == "" {
			missing = append(missing, key)
		}
	}
	return missing
}
