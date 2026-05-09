package command

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"

	"github.com/nova-infra/codex-app/internal/channel/lark"
	"github.com/nova-infra/codex-app/internal/channelapi"
)

func (r *Router) runLark(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("lark requires a subcommand. e.g. lark token or lark send --chat <chat_id> --text <text>\n\n%s", usage)
	}
	switch args[0] {
	case "token":
		return r.runLarkToken(args[1:])
	case "send":
		return r.runLarkSend(args[1:])
	default:
		return fmt.Errorf("unknown lark subcommand %q\n\n%s", args[0], usage)
	}
}

func (r *Router) runLarkToken(args []string) error {
	jsonMode, args := parseJSONCommand(args)
	fs := flag.NewFlagSet("lark token", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("lark token does not accept positional arguments")
	}
	runtime, err := lark.NewRuntimeFromEnv()
	if err != nil {
		return err
	}
	token, err := runtime.TenantAccessToken(context.Background())
	if err != nil {
		return err
	}
	if jsonMode {
		return printJSON(r.out, map[string]any{"ok": true, "data": map[string]any{"token_present": token != ""}})
	}
	_, err = fmt.Fprintln(r.out, "lark token: ok")
	return err
}

func (r *Router) runLarkSend(args []string) error {
	jsonMode, args := parseJSONCommand(args)
	fs := flag.NewFlagSet("lark send", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	chatID := fs.String("chat", "", "Lark chat_id")
	text := fs.String("text", "", "text to send")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("lark send does not accept positional arguments")
	}
	runtime, err := lark.NewRuntimeFromEnv()
	if err != nil {
		return err
	}
	err = runtime.Send(context.Background(), channelapi.RuntimeMessage{ChannelID: *chatID, Text: *text})
	if err != nil {
		return err
	}
	if jsonMode {
		return printJSON(r.out, map[string]any{"ok": true})
	}
	_, err = fmt.Fprintln(r.out, "lark send: ok")
	return err
}
