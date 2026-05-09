package command

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nova-infra/codex-app/internal/config"
	"github.com/nova-infra/codex-app/internal/render"
)

func TestRunUnknownCommand(t *testing.T) {
	var out bytes.Buffer
	r := NewRouter(&out)
	err := r.Run([]string{"does-not-exist"})
	if err == nil || err.Error() == "" {
		t.Fatal("expected unknown command error")
	}
}

func TestRunProjectListRequiresSubcommand(t *testing.T) {
	var out bytes.Buffer
	r := NewRouter(&out)
	err := r.Run([]string{"project"})
	if err == nil {
		t.Fatal("expected project usage error")
	}
}

func TestRunSupportsCustomProjectList(t *testing.T) {
	var out bytes.Buffer
	r := NewRouter(&out, WithListProjects(func() ([]string, error) {
		return []string{"alpha", "beta"}, nil
	}))
	if err := r.Run([]string{"project", "list"}); err != nil {
		t.Fatalf("run project list: %v", err)
	}
	text := out.String()
	if !strings.Contains(text, "alpha") || !strings.Contains(text, "beta") {
		t.Fatalf("expected custom project list, got %q", text)
	}
}

func TestRunSupportsCustomProviders(t *testing.T) {
	var out bytes.Buffer
	r := NewRouter(&out, WithListProviders(func() ([]string, error) {
		return []string{"custom-provider"}, nil
	}))
	if err := r.Run([]string{"provider", "list"}); err != nil {
		t.Fatalf("run provider list: %v", err)
	}
	if got := out.String(); !strings.Contains(got, "custom-provider") {
		t.Fatalf("expected custom provider, got %q", got)
	}
}

func TestRunCapabilitiesForChannel(t *testing.T) {
	var out bytes.Buffer
	r := NewRouter(&out, WithListCapabilities(func(name string) ([]string, error) {
		if name == string(render.ChannelTelegram) {
			return []string{"notify", "reply"}, nil
		}
		if name == "unknown" {
			return nil, errors.New("not found")
		}
		return []string{}, nil
	}))
	if err := r.Run([]string{"capabilities", "list", "--channel", string(render.ChannelTelegram)}); err != nil {
		t.Fatalf("run capabilities list: %v", err)
	}
	for _, item := range []string{"notify", "reply"} {
		if !strings.Contains(out.String(), item) {
			t.Fatalf("expected capability %q, got %q", item, out.String())
		}
	}
}

func TestRunCapabilitiesListJSON(t *testing.T) {
	var out bytes.Buffer
	r := NewRouter(&out, WithListCapabilities(func(name string) ([]string, error) {
		return []string{"alpha"}, nil
	}))
	if err := r.Run([]string{"capabilities", "list", "--json", "--channel", "all"}); err != nil {
		t.Fatalf("run capabilities list json: %v", err)
	}
	got := out.String()
	if !strings.Contains(got, "\"ok\": true") || !strings.Contains(got, "alpha") {
		t.Fatalf("expected json capabilities output, got %q", got)
	}
}

func TestRunDoctor(t *testing.T) {
	var out bytes.Buffer
	r := NewRouter(&out)
	if err := r.Run([]string{"doctor"}); err != nil {
		t.Fatalf("run doctor: %v", err)
	}
	got := out.String()
	if !strings.Contains(got, "go:") && !strings.Contains(got, "doctor:") {
		t.Fatalf("unexpected doctor output: %q", got)
	}
}

func TestRunDoctorJSON(t *testing.T) {
	var out bytes.Buffer
	r := NewRouter(&out)
	if err := r.Run([]string{"doctor", "--json"}); err != nil {
		t.Fatalf("run doctor json: %v", err)
	}
	if !strings.Contains(out.String(), "\"ok\": true") && !strings.Contains(out.String(), "\"ok\": false") {
		t.Fatalf("doctor json output invalid: %q", out.String())
	}
}

func TestRunDoctorWithConfig(t *testing.T) {
	path := writeTestConfig(t, "custom")
	var out bytes.Buffer
	r := NewRouter(&out)
	if err := r.Run([]string{"doctor", "--config", path}); err != nil {
		t.Fatalf("run doctor config: %v", err)
	}
	if !strings.Contains(out.String(), path) {
		t.Fatalf("expected config path in doctor output, got %q", out.String())
	}
}

func TestRunProjectListWithConfig(t *testing.T) {
	path := writeTestConfig(t, "custom")
	var out bytes.Buffer
	r := NewRouter(&out)
	if err := r.Run([]string{"project", "list", "--config", path}); err != nil {
		t.Fatalf("run project list config: %v", err)
	}
	if !strings.Contains(out.String(), "custom") {
		t.Fatalf("expected custom project, got %q", out.String())
	}
}

func TestRunProviderListUsesConfigProviders(t *testing.T) {
	path := writeTestConfigWithProvider(t, "custom", "custom-provider")
	var out bytes.Buffer
	r := NewRouter(&out)
	if err := r.Run([]string{"provider", "list", "--config", path}); err != nil {
		t.Fatalf("run provider list config: %v", err)
	}
	got := out.String()
	if !strings.Contains(got, "custom-provider") {
		t.Fatalf("expected custom provider, got %q", got)
	}
	if strings.Contains(got, "telegram") || strings.Contains(got, "wechat") || strings.Contains(got, "lark") {
		t.Fatalf("provider list must not show channel names: %q", got)
	}
}

func TestRunServeDryRunJSON(t *testing.T) {
	t.Setenv("CODEX_APP_PROVIDER_CLIPROXY_API_KEY", "secret")
	var out bytes.Buffer
	r := NewRouter(&out)
	if err := r.Run([]string{"serve", "--dry-run", "--json"}); err != nil {
		t.Fatalf("run serve dry-run: %v", err)
	}
	got := out.String()
	if !strings.Contains(got, "\"dry_run\": true") {
		t.Fatalf("expect dry_run true in output: %q", got)
	}
	if !strings.Contains(got, `"OPENAI_API_KEY": "<redacted>"`) {
		t.Fatalf("expected readable redaction marker, got %q", got)
	}
	if strings.Contains(got, "secret") || strings.Contains(got, `\u003c`) {
		t.Fatalf("unexpected secret or escaped redaction marker in output: %q", got)
	}
}

func TestRunServeDryRunWithConfig(t *testing.T) {
	path := writeTestConfig(t, "custom")
	var out bytes.Buffer
	r := NewRouter(&out)
	if err := r.Run([]string{"serve", "--dry-run", "--config", path}); err != nil {
		t.Fatalf("run serve config: %v", err)
	}
	if !strings.Contains(out.String(), "\"project\": \"custom\"") {
		t.Fatalf("expected custom project, got %q", out.String())
	}
}

func TestRunProviderListError(t *testing.T) {
	var out bytes.Buffer
	r := NewRouter(&out, WithListProviders(func() ([]string, error) {
		return nil, errors.New("boom")
	}))
	if err := r.Run([]string{"provider", "list"}); err == nil || !strings.Contains(err.Error(), "boom") {
		t.Fatalf("expected provider list error, got %v", err)
	}
}

func TestParseJSONCommand(t *testing.T) {
	jsonRequested, args := parseJSONCommand([]string{"--json", "render-demo", "--channel", "all"})
	if !jsonRequested {
		t.Fatal("expected jsonRequested=true")
	}
	want := []string{"render-demo", "--channel", "all"}
	if len(args) != len(want) {
		t.Fatalf("args len=%d want=%d", len(args), len(want))
	}
	for i := range want {
		if args[i] != want[i] {
			t.Fatalf("args[%d]=%q want=%q", i, args[i], want[i])
		}
	}
}

func TestUpdateEnvFileUpsertsQuotedSecrets(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(path, []byte("LARK_APP_ID=old\nWEIXIN_ILINK_BOT_TOKEN=old-token\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	err := updateEnvFile(path, map[string]string{
		"WEIXIN_ILINK_BOT_TOKEN": `new"token`,
		"WEIXIN_ILINK_BASE":      "https://ilink.example",
	})
	if err != nil {
		t.Fatalf("update env: %v", err)
	}
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	text := string(body)
	if !strings.Contains(text, `WEIXIN_ILINK_BOT_TOKEN="new\"token"`) {
		t.Fatalf("expected updated token, got %s", text)
	}
	if !strings.Contains(text, `WEIXIN_ILINK_BASE="https://ilink.example"`) {
		t.Fatalf("expected appended base, got %s", text)
	}
	if !strings.Contains(text, "LARK_APP_ID=old") {
		t.Fatalf("expected existing env to be preserved, got %s", text)
	}
}

func TestReleaseChecksReportBlockedExternalGates(t *testing.T) {
	t.Setenv("LARK_APP_ID", "")
	t.Setenv("TELEGRAM_BOT_TOKEN", "")
	checks := runReleaseChecks("", false, false)
	if releaseChecksOK(checks) {
		t.Fatal("expected release checks to be blocked without external credentials")
	}
	if !hasReleaseCheck(checks, "telegram.credentials", "blocked") {
		t.Fatalf("expected blocked telegram credential check: %#v", checks)
	}
	if !hasReleaseCheck(checks, "weixin.ilink", "blocked") {
		t.Fatalf("expected blocked weixin ilink check: %#v", checks)
	}
	if !hasReleaseCheck(checks, "approval.render", "ok") {
		t.Fatalf("expected approval render check: %#v", checks)
	}
	if !hasReleaseCheck(checks, "approval.input", "ok") {
		t.Fatalf("expected approval input check: %#v", checks)
	}
}

func TestReleaseChecksAllowOptionalCorpWarning(t *testing.T) {
	checks := []releaseCheck{
		{Name: "config", Status: "ok"},
		{Name: "approval.render", Status: "ok"},
		{Name: "approval.input", Status: "ok"},
		{Name: "lark.token", Status: "ok"},
		{Name: "telegram.token", Status: "ok"},
		{Name: "telegram.chat", Status: "ok"},
		{Name: "weixin.ilink", Status: "ok"},
		{Name: "weixin.corp", Status: "warn"},
		{Name: "service.health", Status: "ok"},
	}
	if !releaseChecksOK(checks) {
		t.Fatalf("optional corp warning must not block release: %#v", checks)
	}
}

func TestReleaseChecksBlockSkippedSmoke(t *testing.T) {
	checks := []releaseCheck{
		{Name: "config", Status: "ok"},
		{Name: "approval.render", Status: "ok"},
		{Name: "approval.input", Status: "ok"},
		{Name: "lark.token", Status: "ok"},
		{Name: "telegram.token", Status: "ok"},
		{Name: "telegram.chat", Status: "ok"},
		{Name: "telegram.smoke", Status: "blocked"},
		{Name: "weixin.ilink", Status: "ok"},
		{Name: "weixin.smoke", Status: "blocked"},
		{Name: "weixin.corp", Status: "warn"},
		{Name: "service.health", Status: "ok"},
	}
	if releaseChecksOK(checks) {
		t.Fatalf("skipped smoke must block release: %#v", checks)
	}
}

func TestCheckApprovalRender(t *testing.T) {
	check := checkApprovalRender()
	if check.Status != "ok" {
		t.Fatalf("approval render check = %#v", check)
	}
}

func TestCheckApprovalInput(t *testing.T) {
	check := checkApprovalInput()
	if check.Status != "ok" {
		t.Fatalf("approval input check = %#v", check)
	}
}

func TestIsApprovalResolvedReply(t *testing.T) {
	if !isApprovalResolvedReply("approval approval-1: confirm") {
		t.Fatal("expected confirm reply to be resolved")
	}
	if !isApprovalResolvedReply("approval approval-1: reject") {
		t.Fatal("expected reject reply to be resolved")
	}
	if isApprovalResolvedReply("approval 请求已创建") {
		t.Fatal("created request must not count as resolved")
	}
}

func TestRunHelpIncludesWeixinUntilApproval(t *testing.T) {
	var out bytes.Buffer
	r := NewRouter(&out)
	if err := r.Run([]string{"help"}); err != nil {
		t.Fatalf("help: %v", err)
	}
	if !strings.Contains(out.String(), "--until-approval") {
		t.Fatalf("expected until-approval in help: %s", out.String())
	}
}

func TestWaitServiceRunningAcceptsThreeRunners(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true,"data":{"lark_ws_status":"connected","telegram_polling_status":"running","weixin_polling_status":"running"}}`))
	})
	server := httptest.NewServer(handler)
	defer server.Close()
	addr := strings.TrimPrefix(server.URL, "http://")
	detail, err := waitServiceRunning(context.Background(), addr)
	if err != nil {
		t.Fatalf("wait service running: %v", err)
	}
	if !strings.Contains(detail, "lark_ws=connected") {
		t.Fatalf("unexpected detail: %s", detail)
	}
}

func TestRunReleaseCheckJSONStrictExitFailsWhenBlocked(t *testing.T) {
	var out bytes.Buffer
	r := NewRouter(&out)
	err := r.Run([]string{"release-check", "--json", "--strict-exit"})
	if err == nil {
		t.Fatal("expected strict exit to fail when blocked")
	}
	if !strings.Contains(out.String(), `"ok": false`) {
		t.Fatalf("expected json output before strict exit failure, got %q", out.String())
	}
}

func TestReleaseChecksRequireE2EEvidence(t *testing.T) {
	checks := runReleaseChecks("", false, true)
	if !hasReleaseCheck(checks, "weixin.inbound_e2e", "blocked") {
		t.Fatalf("expected weixin e2e blocked: %#v", checks)
	}
	if releaseChecksOK(checks) {
		t.Fatalf("missing e2e evidence must block release: %#v", checks)
	}
}

func TestRunReleaseEvidenceMark(t *testing.T) {
	envPath := filepath.Join(t.TempDir(), ".env")
	var out bytes.Buffer
	r := NewRouter(&out)
	err := r.Run([]string{"release-evidence", "mark", "--json", "--telegram-inbound", "--env-file", envPath})
	if err != nil {
		t.Fatalf("mark evidence: %v", err)
	}
	body, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), `CODEX_APP_E2E_TELEGRAM_INBOUND="true"`) {
		t.Fatalf("expected marker in env, got %s", body)
	}
	if !strings.Contains(out.String(), "CODEX_APP_E2E_TELEGRAM_INBOUND") {
		t.Fatalf("expected marker output, got %s", out.String())
	}
}

func TestReleaseUnblockCommandsPointAtFinalE2EGate(t *testing.T) {
	if !strings.Contains(weixinE2EWaitCommand(), "--until-approval") || !strings.Contains(weixinE2EWaitCommand(), "--write-e2e") {
		t.Fatalf("unexpected weixin e2e command: %s", weixinE2EWaitCommand())
	}
	if !strings.Contains(weixinQRConfirmCommand("qr-1"), "weixin qr-confirm --json --qrcode qr-1") {
		t.Fatalf("unexpected weixin qr confirm command: %s", weixinQRConfirmCommand("qr-1"))
	}
	fullE2E := weixinFullE2ECommand("qr-1")
	if !strings.Contains(fullE2E, "weixin qr-confirm --qrcode qr-1") || !strings.Contains(fullE2E, "weixin wait") {
		t.Fatalf("unexpected weixin full e2e command: %s", fullE2E)
	}
	if strings.Contains(fullE2E, "&& set -a;") || !strings.Contains(fullE2E, "&& sh -c") {
		t.Fatalf("weixin full e2e command must group post-qr steps: %s", fullE2E)
	}
	if !strings.Contains(finalReleaseGateCommand(), "--require-e2e") {
		t.Fatalf("unexpected final gate command: %s", finalReleaseGateCommand())
	}
}

func TestRunTelegramWaitJSONTimeoutReturnsError(t *testing.T) {
	t.Setenv("TELEGRAM_BOT_TOKEN", "fake-token")
	var out bytes.Buffer
	r := NewRouter(&out)
	err := r.Run([]string{"telegram", "wait", "--json", "--timeout", "0"})
	if err == nil {
		t.Fatal("expected timeout error")
	}
	if !strings.Contains(out.String(), `"ok": false`) {
		t.Fatalf("expected json failure payload, got %q", out.String())
	}
}

func TestRunWeixinWaitJSONTimeoutReturnsError(t *testing.T) {
	t.Setenv("WEIXIN_ILINK_BOT_TOKEN", "fake-token")
	t.Setenv("WEIXIN_ILINK_BASE", "https://ilink.example")
	var out bytes.Buffer
	r := NewRouter(&out)
	err := r.Run([]string{"weixin", "wait", "--json", "--timeout", "0"})
	if err == nil {
		t.Fatal("expected timeout error")
	}
	if !strings.Contains(out.String(), `"ok": false`) {
		t.Fatalf("expected json failure payload, got %q", out.String())
	}
}

func TestRunWeixinQRConfirmWritesEnv(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path != "/ilink/bot/get_qrcode_status" || req.URL.Query().Get("qrcode") != "qr-1" {
			t.Fatalf("unexpected request: %s?%s", req.URL.Path, req.URL.RawQuery)
		}
		_, _ = w.Write([]byte(`{"ret":0,"status":"confirmed","bot_token":"secret-token","baseurl":"https://ilink.example"}`))
	}))
	defer server.Close()
	envPath := filepath.Join(t.TempDir(), ".env")
	var out bytes.Buffer
	r := NewRouter(&out)
	err := r.Run([]string{"weixin", "qr-confirm", "--json", "--base-url", server.URL, "--qrcode", "qr-1", "--timeout", "1", "--write-env", "--env-file", envPath})
	if err != nil {
		t.Fatalf("qr-confirm: %v", err)
	}
	if !strings.Contains(out.String(), `"ok": true`) {
		t.Fatalf("expected success json, got %q", out.String())
	}
	body, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), `WEIXIN_ILINK_BOT_TOKEN="secret-token"`) {
		t.Fatalf("expected token in env, got %s", body)
	}
}

func hasReleaseCheck(checks []releaseCheck, name string, status string) bool {
	for _, check := range checks {
		if check.Name == name && check.Status == status {
			return true
		}
	}
	return false
}

func writeTestConfig(t *testing.T, projectName string) string {
	t.Helper()
	cfg := config.Default()
	cfg.Projects[0].Name = projectName
	body, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, body, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func writeTestConfigWithProvider(t *testing.T, projectName string, providerName string) string {
	t.Helper()
	cfg := config.Default()
	cfg.Projects[0].Name = projectName
	cfg.Providers[0].Name = providerName
	cfg.Projects[0].ProviderRefs = []string{providerName}
	body, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, body, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}
