package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/nova-infra/codex-app/internal/build"
	"github.com/nova-infra/codex-app/internal/codex"
	"github.com/nova-infra/codex-app/internal/config"
	"github.com/nova-infra/codex-app/internal/kernel"
	"github.com/nova-infra/codex-app/internal/project"
	"github.com/nova-infra/codex-app/internal/provider"
	"github.com/nova-infra/codex-app/internal/runtime"
)

const DefaultAddr = "127.0.0.1:8787"

type ServeOptions struct {
	DryRun      bool
	ProjectName string
	ConfigPath  string
	Addr        string
	Ready       chan<- string
}

type ServePlan struct {
	Plan         runtime.StartupPlan
	DryRun       bool
	ConfigSource string
}

type HTTPService struct {
	plan         ServePlan
	configSource string
	lark         larkEventService
	larkWS       *larkWSRunner
	telegram     *telegramPollingRunner
	weixin       *weixinPollingRunner
}

func NewServePlan(dryRun bool, projectName string) (ServePlan, error) {
	return NewServePlanWithConfig(dryRun, projectName, "", "")
}

func NewServePlanWithConfig(dryRun bool, projectName string, configPath string, addr string) (ServePlan, error) {
	loaded, err := config.Load(configPath)
	if err != nil {
		return ServePlan{}, err
	}
	plan, err := runtime.BuildStartupPlanFromConfig(loaded.Config, projectName)
	if err != nil {
		return ServePlan{}, err
	}
	plan.DryRun = dryRun
	if plan.ProviderConfig != nil {
		plan.ProviderConfig.DryRun = dryRun
	}
	plan.Addr = normalizeAddr(addr)
	return ServePlan{Plan: plan, DryRun: dryRun, ConfigSource: loaded.Source}, nil
}

func (s ServePlan) String() string {
	if s.DryRun {
		return marshalJSON(s.Plan)
	}
	return runtime.StartupSummary(s.Plan)
}

func Start(options ServeOptions) (string, error) {
	return StartContext(context.Background(), options)
}

func StartContext(ctx context.Context, options ServeOptions) (string, error) {
	plan, err := NewServePlanWithConfig(options.DryRun, options.ProjectName, options.ConfigPath, options.Addr)
	if err != nil {
		return "", err
	}
	if options.DryRun {
		return plan.String(), nil
	}
	if err := runtime.MissingChannelEnvError(plan.Plan.Channels); err != nil {
		return "", err
	}
	if _, err := prepareProviderConfig(options.ConfigPath, options.ProjectName); err != nil {
		return "", err
	}
	return ServeHTTP(ctx, plan, options.Ready)
}

func prepareProviderConfig(configPath string, projectName string) (codex.ProviderConfigPlan, error) {
	loaded, err := config.Load(configPath)
	if err != nil {
		return codex.ProviderConfigPlan{}, err
	}
	proj, err := project.ResolveProject(loaded.Config.Projects, projectName)
	if err != nil {
		return codex.ProviderConfigPlan{}, err
	}
	providerCfg, err := provider.ResolveProvider(loaded.Config.Providers, proj.ProviderRefs[0])
	if err != nil {
		return codex.ProviderConfigPlan{}, err
	}
	return codex.WriteProviderConfig(proj, providerCfg)
}

func ServeHTTP(ctx context.Context, plan ServePlan, ready chan<- string) (string, error) {
	if err := runtime.MissingChannelEnvError(plan.Plan.Channels); err != nil {
		return "", err
	}
	addr := normalizeAddr(plan.Plan.Addr)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return "", fmt.Errorf("listen %s: %w", addr, err)
	}
	actualAddr := listener.Addr().String()
	plan.Plan.Addr = actualAddr
	service := NewHTTPService(plan)
	service.startRuntimes(ctx)
	httpServer := &http.Server{Handler: service.Routes()}
	errc := make(chan error, 1)
	go func() {
		err := httpServer.Serve(listener)
		if errors.Is(err, http.ErrServerClosed) {
			errc <- nil
			return
		}
		errc <- err
	}()
	if ready != nil {
		ready <- actualAddr
	}
	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), runtime.ShutdownTimeout())
		defer cancel()
		if err := httpServer.Shutdown(shutdownCtx); err != nil {
			return "", fmt.Errorf("shutdown server: %w", err)
		}
		return fmt.Sprintf("codex-app stopped: %s", actualAddr), nil
	case err := <-errc:
		if err != nil {
			return "", fmt.Errorf("serve http: %w", err)
		}
		return fmt.Sprintf("codex-app stopped: %s", actualAddr), nil
	}
}

func NewHTTPService(plan ServePlan) HTTPService {
	larkService := newLarkEventService()
	larkWS, _ := newLarkWSRunner(larkService)
	telegramRunner, _ := newTelegramPollingRunner(plan.Plan.Channels)
	weixinRunner, _ := newWeixinPollingRunner(plan.Plan.Channels)
	return HTTPService{plan: plan, configSource: plan.ConfigSource, lark: larkService, larkWS: larkWS, telegram: telegramRunner, weixin: weixinRunner}
}

func (s HTTPService) startRuntimes(ctx context.Context) {
	if s.larkWS != nil {
		s.larkWS.start(ctx)
	}
	if s.telegram != nil {
		s.telegram.start(ctx)
	}
	if s.weixin != nil {
		s.weixin.start(ctx)
	}
}

func (s HTTPService) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /version", s.handleVersion)
	mux.HandleFunc("GET /config", s.handleConfig)
	mux.HandleFunc("GET /render-demo", s.handleRenderDemo)
	mux.HandleFunc("POST /lark/events", s.lark.handleEvent)
	mux.HandleFunc("POST /lark/send", s.lark.handleSend)
	mux.HandleFunc("/", s.handleNotFound)
	return mux
}

func (s HTTPService) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true,
		"data": map[string]any{
			"service":                 "codex-app",
			"status":                  "ok",
			"channels":                s.plan.Plan.Channels,
			"lark_ready":              s.lark.ready(),
			"lark_ws":                 s.larkWS != nil && s.larkWS.started,
			"lark_ws_status":          s.larkWS.healthStatus(),
			"telegram_polling":        s.telegram != nil && s.telegram.started,
			"telegram_polling_status": s.telegram.healthStatus(),
			"weixin_polling":          s.weixin != nil && s.weixin.started,
			"weixin_polling_status":   s.weixin.healthStatus(),
		},
	})
}

func (s HTTPService) handleVersion(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"data": build.Info(),
	})
}

func (s HTTPService) handleConfig(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true,
		"data": map[string]any{
			"source": s.configSource,
			"plan":   s.plan.Plan,
		},
	})
}

func (s HTTPService) handleRenderDemo(w http.ResponseWriter, req *http.Request) {
	channelName := strings.TrimSpace(req.URL.Query().Get("channel"))
	if channelName == "" {
		channelName = "all"
	}
	result, err := kernel.RenderDemo(kernel.DemoRequest{Channel: channelName})
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": result.Messages})
}

func (s HTTPService) handleNotFound(w http.ResponseWriter, req *http.Request) {
	writeJSON(w, http.StatusNotFound, map[string]any{
		"ok":    false,
		"error": "not found: " + req.URL.Path,
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	encoder := json.NewEncoder(w)
	encoder.SetIndent("", "  ")
	_ = encoder.Encode(payload)
}

func normalizeAddr(addr string) string {
	trimmed := strings.TrimSpace(addr)
	if trimmed == "" {
		return DefaultAddr
	}
	return trimmed
}

func ensureConfigPaths() (string, string) {
	home := os.Getenv("HOME")
	if home == "" {
		home = "."
	}
	return filepath.Join(home, ".codex-app", "config.json"), filepath.Join(home, ".codex-app")
}

func DoctorJSON() (string, error) {
	cfgPath, dataDir := ensureConfigPaths()
	report := map[string]any{
		"ok": true,
		"data": map[string]any{
			"cwd":        mustGetwd(),
			"configPath": cfgPath,
			"dataDir":    dataDir,
			"goEntry":    "./cmd/codex-app",
		},
		"meta": map[string]any{"command": "doctor"},
	}
	return marshalJSON(report) + "\n", nil
}

func mustGetwd() string {
	cwd, err := os.Getwd()
	if err != nil {
		return ""
	}
	return cwd
}

func marshalJSON(payload any) string {
	var builder strings.Builder
	encoder := json.NewEncoder(&builder)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(payload); err != nil {
		return "{}"
	}
	return strings.TrimSuffix(builder.String(), "\n")
}
