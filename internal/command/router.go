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
	"github.com/nova-infra/codex-app/internal/kernel"
)

const usage = `codex-app Go preview

Usage:
  codex-app render-demo --channel telegram|wechat|lark|all
  codex-app project list
  codex-app provider list
  codex-app capabilities list [--channel <telegram|wechat|lark|all>]
  codex-app help

The Go preview is milestone 2 of the rewrite. It renders a mock Codex event
stream into platform-specific messages and exposes lightweight discovery commands.
`

// Router executes CLI commands for the Go preview path.
type Router struct {
	out                io.Writer
	listProjects       func() ([]string, error)
	listProviders      func() ([]string, error)
	listCapabilities   func(channel string) ([]string, error)
	renderDemoDelegate func(channelName string) (string, error)
}

func defaultListProjects() ([]string, error) {
	return []string{"default"}, nil
}

func defaultListProviders() ([]string, error) {
	channels := channel.ListChannels()
	names := make([]string, len(channels))
	for i, ch := range channels {
		names[i] = string(ch)
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
	return func(r *Router) { r.listProjects = fn }
}

func WithListProviders(fn func() ([]string, error)) func(*Router) {
	return func(r *Router) { r.listProviders = fn }
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
	default:
		return fmt.Errorf("unknown command %q\n\n%s", args[0], usage)
	}
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

func (r *Router) runProject(args []string) error {
	if len(args) != 1 || args[0] != "list" {
		return fmt.Errorf("project requires a subcommand. e.g. project list\n\n%s", usage)
	}
	projects, err := r.listProjects()
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
	if len(args) != 1 || args[0] != "list" {
		return fmt.Errorf("provider requires a subcommand. e.g. provider list\n\n%s", usage)
	}
	providers, err := r.listProviders()
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
