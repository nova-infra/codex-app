package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/nova-infra/codex-app/internal/kernel"
)

const usage = `codex-app Go preview

Usage:
  codex-app render-demo --channel telegram|wechat|lark|all
  codex-app help

The Go preview is milestone 1 of the rewrite. It renders a mock Codex event
stream into platform-specific messages without connecting to real platforms.
`

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string, out io.Writer) error {
	if len(args) == 0 {
		_, err := fmt.Fprint(out, usage)
		return err
	}
	switch args[0] {
	case "help", "--help", "-h":
		_, err := fmt.Fprint(out, usage)
		return err
	case "render-demo":
		return runRenderDemo(args[1:], out)
	default:
		return fmt.Errorf("unknown command %q\n\n%s", args[0], usage)
	}
}

func runRenderDemo(args []string, out io.Writer) error {
	fs := flag.NewFlagSet("render-demo", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	channelName := fs.String("channel", "all", "target channel: telegram, wechat, lark, all")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() > 0 {
		return errors.New("render-demo does not accept positional arguments")
	}
	result, err := kernel.RenderDemo(kernel.DemoRequest{Channel: *channelName})
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(out)
	encoder.SetIndent("", "  ")
	return encoder.Encode(result.Messages)
}
