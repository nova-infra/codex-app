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

	"github.com/nova-infra/codex-app/internal/channel/telegram"
	"github.com/nova-infra/codex-app/internal/channelapi"
)

func (r *Router) runTelegram(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("telegram requires a subcommand. e.g. telegram token, telegram updates, or telegram send --chat <chat_id> --text <text>\n\n%s", usage)
	}
	switch args[0] {
	case "token":
		return r.runTelegramToken(args[1:])
	case "updates":
		return r.runTelegramUpdates(args[1:])
	case "wait":
		return r.runTelegramWait(args[1:])
	case "send":
		return r.runTelegramSend(args[1:])
	default:
		return fmt.Errorf("unknown telegram subcommand %q\n\n%s", args[0], usage)
	}
}

func (r *Router) runTelegramToken(args []string) error {
	jsonMode, args := parseJSONCommand(args)
	fs := flag.NewFlagSet("telegram token", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("telegram token does not accept positional arguments")
	}
	runtime, err := telegram.NewRuntimeFromEnv()
	if err != nil {
		return err
	}
	me, err := runtime.GetMeInfo(context.Background())
	if err != nil {
		return err
	}
	if jsonMode {
		return printJSON(r.out, map[string]any{"ok": true, "data": map[string]any{
			"token_valid": true,
			"username":    me.Username,
			"name":        me.Name,
		}})
	}
	_, err = fmt.Fprintf(r.out, "telegram token: ok\nusername: %s\n", me.Username)
	return err
}

func (r *Router) runTelegramUpdates(args []string) error {
	jsonMode, args := parseJSONCommand(args)
	fs := flag.NewFlagSet("telegram updates", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	limit := fs.Int("limit", 5, "maximum updates to fetch")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("telegram updates does not accept positional arguments")
	}
	runtime, err := telegram.NewRuntimeFromEnv()
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
		if _, err := fmt.Fprintln(r.out, formatTelegramUpdate(update)); err != nil {
			return err
		}
	}
	return nil
}

func (r *Router) runTelegramWait(args []string) error {
	jsonMode, args := parseJSONCommand(args)
	fs := flag.NewFlagSet("telegram wait", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	timeoutSeconds := fs.Int("timeout", 120, "seconds to wait for first Telegram message")
	writeEnv := fs.Bool("write-env", false, "write chat id to .env")
	envFile := fs.String("env-file", ".env", "env file path for --write-env")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("telegram wait does not accept positional arguments")
	}
	runtime, err := telegram.NewRuntimeFromEnv()
	if err != nil {
		return err
	}
	deadline := time.Now().Add(time.Duration(*timeoutSeconds) * time.Second)
	var offset int64
	for time.Now().Before(deadline) {
		remaining := time.Until(deadline)
		pollTimeout := 10
		if remaining < 10*time.Second {
			pollTimeout = int(remaining.Seconds())
			if pollTimeout <= 0 {
				pollTimeout = 1
			}
		}
		updates, err := runtime.GetUpdatesSince(context.Background(), offset, 10, pollTimeout)
		if err != nil {
			return err
		}
		for _, update := range updates {
			if update.UpdateID >= offset {
				offset = update.UpdateID + 1
			}
			if strings.TrimSpace(update.ChannelID) == "" {
				continue
			}
			envWritten := false
			if *writeEnv {
				if err := updateEnvFile(*envFile, map[string]string{"TELEGRAM_CHAT_ID": update.ChannelID}); err != nil {
					return err
				}
				envWritten = true
			}
			if jsonMode {
				return printJSON(r.out, map[string]any{"ok": true, "data": map[string]any{
					"chat_id":     update.ChannelID,
					"update_id":   update.UpdateID,
					"text":        update.Payload,
					"env_written": envWritten,
				}})
			}
			_, err := fmt.Fprintf(r.out, "%d\t%s\t%s\nenv_written: %v\n", update.UpdateID, update.ChannelID, update.Payload, envWritten)
			return err
		}
	}
	if jsonMode {
		if err := printJSON(r.out, map[string]any{"ok": false, "error": "telegram wait timed out"}); err != nil {
			return err
		}
		return fmt.Errorf("telegram wait timed out after %d seconds", *timeoutSeconds)
	}
	return fmt.Errorf("telegram wait timed out after %d seconds", *timeoutSeconds)
}

func (r *Router) runTelegramSend(args []string) error {
	jsonMode, args := parseJSONCommand(args)
	fs := flag.NewFlagSet("telegram send", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	chatID := fs.String("chat", "", "Telegram chat_id")
	text := fs.String("text", "", "text to send")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("telegram send does not accept positional arguments")
	}
	runtime, err := telegram.NewRuntimeFromEnv()
	if err != nil {
		return err
	}
	targetChat := strings.TrimSpace(*chatID)
	if targetChat == "" {
		targetChat = strings.TrimSpace(os.Getenv("TELEGRAM_CHAT_ID"))
	}
	if err := runtime.Send(context.Background(), channelapi.RuntimeMessage{ChannelID: targetChat, Text: *text}); err != nil {
		return err
	}
	if jsonMode {
		return printJSON(r.out, map[string]any{"ok": true})
	}
	_, err = fmt.Fprintln(r.out, "telegram send: ok")
	return err
}

func formatTelegramUpdate(update channelapi.RuntimeUpdate) string {
	return strconv.FormatInt(update.UpdateID, 10) + "\t" + update.ChannelID + "\t" + update.Payload
}
