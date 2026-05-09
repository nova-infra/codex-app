package command

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"sort"
	"strings"

	"github.com/nova-infra/codex-app/internal/channel"
	"github.com/nova-infra/codex-app/internal/config"
	"github.com/nova-infra/codex-app/internal/kernel"
	"github.com/nova-infra/codex-app/internal/runtime"
	"github.com/nova-infra/codex-app/internal/server"
)

const usage = `codex-app Go service

Usage:
  codex-app render-demo --channel telegram|wechat|lark|all
  codex-app project list [--config <path>]
  codex-app provider list [--config <path>]
  codex-app capabilities list [--channel <telegram|wechat|lark|all>]
  codex-app serve [--dry-run] [--project <name>] [--config <path>] [--addr <host:port>]
  codex-app lark token
  codex-app lark send --chat <chat_id> --text <text>
  codex-app telegram token
  codex-app telegram updates [--limit <n>]
  codex-app telegram wait [--timeout <seconds>] [--write-env]
  codex-app telegram send --chat <chat_id> --text <text>
  codex-app weixin token
  codex-app weixin qr
  codex-app weixin qr-wait [--timeout <seconds>] [--write-env]
  codex-app weixin qr-confirm --qrcode <qrcode> [--timeout <seconds>] [--write-env]
  codex-app weixin qr-status --qrcode <qrcode> [--write-env]
  codex-app weixin updates [--limit <n>]
  codex-app weixin wait [--timeout <seconds>] [--reply] [--write-e2e] [--until-approval]
  codex-app weixin send --user <userid> --text <text>
  codex-app release-check [--config <path>] [--smoke] [--require-e2e] [--strict-exit]
  codex-app release-evidence mark --telegram-inbound|--weixin-inbound|--approval-real
  codex-app release-unblock
  codex-app doctor [--config <path>]
  codex-app help

The Go service renders Codex events into platform-specific messages and exposes
HTTP endpoints for health, version, config, and render-demo smoke checks.
`

// Router executes CLI commands for the Go service path.
type Router struct {
	out                io.Writer
	listProjects       func(configPath string) ([]string, error)
	listProviders      func(configPath string) ([]string, error)
	listCapabilities   func(channel string) ([]string, error)
	renderDemoDelegate func(channelName string) (string, error)
}

func defaultListProjects(configPath string) ([]string, error) {
	loaded, err := config.Load(configPath)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(loaded.Config.Projects))
	for _, p := range loaded.Config.Projects {
		names = append(names, p.Name)
	}
	sort.Strings(names)
	return names, nil
}

func defaultListProviders(configPath string) ([]string, error) {
	loaded, err := config.Load(configPath)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(loaded.Config.Providers))
	for _, providerCfg := range loaded.Config.Providers {
		names = append(names, providerCfg.Name)
	}
	sort.Strings(names)
	return names, nil
}

func defaultListCapabilities(name string) ([]string, error) {
	caps, err := channel.Capabilities(name)
	if err != nil {
		return nil, err
	}
	result := make([]string, 0, len(caps))
	for _, capb := range caps {
		result = append(result, string(capb))
	}
	sort.Strings(result)
	return result, nil
}

func defaultRenderDemo(channelName string) (string, error) {
	result, err := kernel.RenderDemo(kernel.DemoRequest{Channel: channelName})
	if err != nil {
		return "", err
	}
	out, err := json.MarshalIndent(result.Messages, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal demo result: %w", err)
	}
	return string(out), nil
}

// NewRouter creates a command router. Tests can pass custom function hooks.
func NewRouter(out io.Writer, opts ...func(*Router)) *Router {
	r := &Router{
		out:                out,
		listProjects:       defaultListProjects,
		listProviders:      defaultListProviders,
		listCapabilities:   defaultListCapabilities,
		renderDemoDelegate: defaultRenderDemo,
	}
	for _, opt := range opts {
		opt(r)
	}
	return r
}

func WithListProjects(fn func() ([]string, error)) func(*Router) {
	return func(r *Router) {
		r.listProjects = func(_ string) ([]string, error) {
			return fn()
		}
	}
}

func WithListProviders(fn func() ([]string, error)) func(*Router) {
	return func(r *Router) {
		r.listProviders = func(_ string) ([]string, error) {
			return fn()
		}
	}
}

func WithListCapabilities(fn func(string) ([]string, error)) func(*Router) {
	return func(r *Router) { r.listCapabilities = fn }
}

func WithRenderDemo(fn func(string) (string, error)) func(*Router) {
	return func(r *Router) { r.renderDemoDelegate = fn }
}

func (r *Router) Run(args []string) error {
	if len(args) == 0 {
		_, err := fmt.Fprint(r.out, usage)
		return err
	}

	switch args[0] {
	case "help", "--help", "-h":
		_, err := fmt.Fprint(r.out, usage)
		return err
	case "render-demo":
		return r.runRenderDemo(args[1:])
	case "project":
		return r.runProject(args[1:])
	case "provider":
		return r.runProvider(args[1:])
	case "capabilities":
		return r.runCapabilities(args[1:])
	case "doctor":
		return r.runDoctor(args[1:])
	case "lark":
		return r.runLark(args[1:])
	case "telegram":
		return r.runTelegram(args[1:])
	case "weixin", "wechat":
		return r.runWeixin(args[1:])
	case "serve":
		return r.runServe(args[1:])
	case "release-check":
		return r.runReleaseCheck(args[1:])
	case "release-evidence":
		return r.runReleaseEvidence(args[1:])
	case "release-unblock":
		return r.runReleaseUnblock(args[1:])
	default:
		return fmt.Errorf("unknown command %q\n\n%s", args[0], usage)
	}
}

func (r *Router) runDoctor(args []string) error {
	jsonMode, args := parseJSONCommand(args)
	fs := flag.NewFlagSet("doctor", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	configPath := fs.String("config", "", "path to JSON config")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("doctor does not accept positional arguments")
	}
	loaded, err := config.Load(*configPath)
	if err != nil {
		return err
	}
	report := runtime.RunDoctorWithConfig(loaded.Config, loaded.Source)
	if jsonMode {
		return printJSON(r.out, map[string]any{
			"ok":   report.Ok(),
			"data": report.Checks,
			"meta": map[string]string{"command": "doctor", "config": loaded.Source},
		})
	}
	if report.Ok() {
		_, err := fmt.Fprintln(r.out, "doctor: ok")
		if err != nil {
			return err
		}
	}
	for _, check := range report.Checks {
		_, err := fmt.Fprintf(r.out, "- %s: %s", check.Name, check.Status)
		if err != nil {
			return err
		}
		if check.Detail != "" {
			_, err = fmt.Fprintf(r.out, " (%s)", check.Detail)
			if err != nil {
				return err
			}
		}
		_, err = fmt.Fprintln(r.out)
		if err != nil {
			return err
		}
	}
	return nil
}

func (r *Router) runRenderDemo(args []string) error {
	jsonMode, args := parseJSONCommand(args)
	fs := flag.NewFlagSet("render-demo", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	channelName := fs.String("channel", "all", "target channel: telegram, wechat, lark, all")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() > 0 {
		return errors.New("render-demo does not accept positional arguments")
	}
	result, err := r.renderDemoDelegate(*channelName)
	if err != nil {
		return err
	}
	if jsonMode {
		return printJSON(r.out, map[string]any{"ok": true, "data": json.RawMessage([]byte(result))})
	}
	_, err = io.WriteString(r.out, result)
	if err != nil {
		return err
	}
	_, err = io.WriteString(r.out, "\n")
	return err
}

func (r *Router) runServe(args []string) error {
	jsonMode, args := parseJSONCommand(args)
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	dryRun := fs.Bool("dry-run", false, "print startup plan without starting")
	projectName := fs.String("project", "", "project name to use")
	configPath := fs.String("config", "", "path to JSON config")
	addr := fs.String("addr", server.DefaultAddr, "HTTP listen address")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() > 0 {
		return errors.New("serve does not accept positional arguments")
	}
	plan, err := server.NewServePlanWithConfig(*dryRun, *projectName, *configPath, *addr)
	if err != nil {
		return err
	}
	if jsonMode {
		return printJSON(r.out, map[string]any{
			"ok":   true,
			"data": map[string]any{"project": *projectName, "dry_run": *dryRun, "addr": *addr, "plan": plan.Plan},
		})
	}
	msg, err := server.Start(server.ServeOptions{DryRun: *dryRun, ProjectName: *projectName, ConfigPath: *configPath, Addr: *addr})
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(r.out, msg)
	return err
}

func (r *Router) runProject(args []string) error {
	if len(args) < 1 || args[0] != "list" {
		return fmt.Errorf("project requires a subcommand. e.g. project list\n\n%s", usage)
	}
	fs := flag.NewFlagSet("project list", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	configPath := fs.String("config", "", "path to JSON config")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	if fs.NArg() > 0 {
		return errors.New("project list does not accept positional arguments")
	}
	projects, err := r.listProjects(*configPath)
	if err != nil {
		return err
	}
	if len(projects) == 0 {
		_, err = fmt.Fprintln(r.out)
		return err
	}
	for _, project := range projects {
		if _, err = fmt.Fprintln(r.out, project); err != nil {
			return err
		}
	}
	return nil
}

func (r *Router) runProvider(args []string) error {
	if len(args) < 1 || args[0] != "list" {
		return fmt.Errorf("provider requires a subcommand. e.g. provider list\n\n%s", usage)
	}
	fs := flag.NewFlagSet("provider list", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	configPath := fs.String("config", "", "path to JSON config")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	if fs.NArg() > 0 {
		return errors.New("provider list does not accept positional arguments")
	}
	providers, err := r.listProviders(*configPath)
	if err != nil {
		return err
	}
	if len(providers) == 0 {
		_, err = fmt.Fprintln(r.out)
		return err
	}
	for _, provider := range providers {
		if _, err = fmt.Fprintln(r.out, provider); err != nil {
			return err
		}
	}
	return nil
}

func (r *Router) runCapabilities(args []string) error {
	jsonMode, args := parseJSONCommand(args)
	if len(args) < 1 || args[0] != "list" {
		return fmt.Errorf("capabilities requires a subcommand. e.g. capabilities list --channel all\n\n%s", usage)
	}
	fs := flag.NewFlagSet("capabilities", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	channelName := fs.String("channel", "all", "target channel: telegram, wechat, lark, all")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	if fs.NArg() > 0 {
		return errors.New("capabilities list does not accept positional arguments")
	}
	caps, err := r.listCapabilities(*channelName)
	if err != nil {
		return err
	}
	if jsonMode {
		return printJSON(r.out, map[string]any{"ok": true, "data": caps})
	}
	if len(caps) == 0 {
		_, err = fmt.Fprintln(r.out)
		return err
	}
	for _, capb := range caps {
		if _, err = fmt.Fprintln(r.out, capb); err != nil {
			return err
		}
	}
	return nil
}

func Run(args []string, out io.Writer) error {
	return NewRouter(out).Run(args)
}

func printJSON(out io.Writer, payload any) error {
	encoder := json.NewEncoder(out)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	return encoder.Encode(payload)
}

// parseJSONCommand normalizes JSON flags for future extension.
func parseJSONCommand(args []string) (jsonRequested bool, cleaned []string) {
	for _, arg := range args {
		if strings.EqualFold(arg, "--json") {
			jsonRequested = true
			continue
		}
		cleaned = append(cleaned, arg)
	}
	return
}
