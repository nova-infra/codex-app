package command

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"sort"
)

func (r *Router) runReleaseEvidence(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("release-evidence requires a subcommand. e.g. release-evidence mark --telegram-inbound\n\n%s", usage)
	}
	switch args[0] {
	case "mark":
		return r.runReleaseEvidenceMark(args[1:])
	default:
		return fmt.Errorf("unknown release-evidence subcommand %q\n\n%s", args[0], usage)
	}
}

func (r *Router) runReleaseEvidenceMark(args []string) error {
	jsonMode, args := parseJSONCommand(args)
	fs := flag.NewFlagSet("release-evidence mark", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	telegramInbound := fs.Bool("telegram-inbound", false, "mark Telegram inbound/reply E2E evidence")
	weixinInbound := fs.Bool("weixin-inbound", false, "mark Weixin inbound/reply E2E evidence")
	approvalReal := fs.Bool("approval-real", false, "mark real platform approval confirm/reject E2E evidence")
	envFile := fs.String("env-file", ".env", "env file path for evidence markers")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("release-evidence mark does not accept positional arguments")
	}
	values := map[string]string{}
	if *telegramInbound {
		values["CODEX_APP_E2E_TELEGRAM_INBOUND"] = "true"
	}
	if *weixinInbound {
		values["CODEX_APP_E2E_WEIXIN_INBOUND"] = "true"
	}
	if *approvalReal {
		values["CODEX_APP_E2E_APPROVAL_REAL"] = "true"
	}
	if len(values) == 0 {
		return errors.New("release-evidence mark requires at least one marker flag")
	}
	if err := updateEnvFile(*envFile, values); err != nil {
		return err
	}
	if jsonMode {
		return printJSON(r.out, map[string]any{"ok": true, "data": map[string]any{"markers_written": sortedKeys(values)}})
	}
	_, err := fmt.Fprintf(r.out, "release evidence marked: %v\n", sortedKeys(values))
	return err
}

func sortedKeys(values map[string]string) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
