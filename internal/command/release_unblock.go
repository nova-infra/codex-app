package command

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"time"

	"github.com/nova-infra/codex-app/internal/channel/telegram"
	"github.com/nova-infra/codex-app/internal/channel/weixin"
)

type releaseUnblockPayload struct {
	TelegramBot      string `json:"telegram_bot,omitempty"`
	TelegramBotURL   string `json:"telegram_bot_url,omitempty"`
	TelegramWait     string `json:"telegram_wait"`
	WeixinQRCode     string `json:"weixin_qrcode"`
	WeixinQRCodeURL  string `json:"weixin_qrcode_url"`
	WeixinWait       string `json:"weixin_wait"`
	WeixinE2EWait    string `json:"weixin_e2e_wait"`
	WeixinFullE2E    string `json:"weixin_full_e2e"`
	FinalReleaseGate string `json:"final_release_gate"`
}

func (r *Router) runReleaseUnblock(args []string) error {
	jsonMode, args := parseJSONCommand(args)
	fs := flag.NewFlagSet("release-unblock", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	baseURL := fs.String("weixin-base-url", "", "iLink API base URL")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("release-unblock does not accept positional arguments")
	}
	payload, err := buildReleaseUnblockPayload(*baseURL)
	if err != nil {
		return err
	}
	if jsonMode {
		return printJSON(r.out, map[string]any{"ok": true, "data": payload})
	}
	_, err = fmt.Fprintf(r.out, "telegram_bot: %s\ntelegram_bot_url: %s\ntelegram_wait: %s\nweixin_qrcode_url: %s\nweixin_wait: %s\nweixin_e2e_wait: %s\nweixin_full_e2e: %s\nfinal_release_gate: %s\n",
		payload.TelegramBot,
		payload.TelegramBotURL,
		payload.TelegramWait,
		payload.WeixinQRCodeURL,
		payload.WeixinWait,
		payload.WeixinE2EWait,
		payload.WeixinFullE2E,
		payload.FinalReleaseGate,
	)
	return err
}

func buildReleaseUnblockPayload(weixinBaseURL string) (releaseUnblockPayload, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	qr, err := weixin.GetQRCode(ctx, weixinBaseURL)
	if err != nil {
		return releaseUnblockPayload{}, err
	}
	bot := ""
	botURL := ""
	if rt, err := telegram.NewRuntimeFromEnv(); err == nil {
		meCtx, meCancel := context.WithTimeout(context.Background(), 15*time.Second)
		if me, err := rt.GetMeInfo(meCtx); err == nil && me.Username != "" {
			bot = "@" + me.Username
			botURL = "https://t.me/" + me.Username
		}
		meCancel()
	}
	return releaseUnblockPayload{
		TelegramBot:      bot,
		TelegramBotURL:   botURL,
		TelegramWait:     telegramWaitCommand(),
		WeixinQRCode:     qr.QRCode,
		WeixinQRCodeURL:  qr.QRCodeURL,
		WeixinWait:       weixinQRConfirmCommand(qr.QRCode),
		WeixinE2EWait:    weixinE2EWaitCommand(),
		WeixinFullE2E:    weixinFullE2ECommand(qr.QRCode),
		FinalReleaseGate: finalReleaseGateCommand(),
	}, nil
}

func telegramWaitCommand() string {
	return "go run ./cmd/codex-app telegram wait --json --timeout 120 --write-env"
}

func weixinQRConfirmCommand(qrcode string) string {
	return "go run ./cmd/codex-app weixin qr-confirm --json --qrcode " + qrcode + " --timeout 180 --write-env"
}

func weixinE2EWaitCommand() string {
	return "go run ./cmd/codex-app weixin wait --json --timeout 120 --reply --write-e2e --until-approval"
}

func weixinFullE2ECommand(qrcode string) string {
	return "go run ./cmd/codex-app weixin qr-confirm --qrcode " + qrcode + " --timeout 180 --write-env && sh -c 'set -a; . ./.env; set +a; go run ./cmd/codex-app weixin wait --json --timeout 240 --reply --write-e2e --until-approval'"
}

func finalReleaseGateCommand() string {
	return "go run ./cmd/codex-app release-check --json --smoke --require-e2e --strict-exit"
}
