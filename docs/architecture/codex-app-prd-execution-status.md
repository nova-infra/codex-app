# codex-app PRD 执行状态

来源：`docs/architecture/codex-app-prd-plan.html`

更新日期：2026-05-10

## 目标口径

本轮目标按“三端完整发布态”收口：机器门禁必须覆盖三端凭据、服务启动、轻量平台 smoke；真实聊天入口还必须由客户端消息触发服务回复，不能只用单元测试、dry-run 或 health 代理证明。

## 验收映射

| PRD 项 | 当前状态 | 证据 |
|---|---|---|
| Go CLI 可启动 | 已完成 | `go run ./cmd/codex-app --help` 输出 `render-demo`、`project list`、`provider list`、`serve`、`doctor` |
| doctor 可诊断 | 已完成 | `go run ./cmd/codex-app doctor` 输出 go/module/config/runtime 为 ok，缺失 channel env 为 warn |
| dry-run 不启动外部连接也能输出装配结果 | 已完成 | `go run ./cmd/codex-app serve --dry-run --json` 输出 project/provider/codex_home/channels/services |
| render-demo 可用 | 已完成 | `go run ./cmd/codex-app render-demo --channel all` 覆盖 telegram / wechat / lark |
| project/provider 走配置真相源 | 已完成 | `project list --config`、`provider list --config` 已由 `internal/config` 加载；provider list 不再输出 channel 名 |
| project-local CODEX_HOME | 已完成 | startup plan 输出 `/Users/Bigo/.codex-app/codex-home`；`project.NormalizeCodexHome` 单测覆盖 |
| Codex app-server launch command | 已完成 | dry-run 输出 `launch_command.executable=codex`、`args=[app-server,--model,...]` |
| provider config 写入策略 | 已完成到保守实现 | dry-run 输出 `provider_config.path/changed/dry_run`；正式 `serve` 写入 project-local `CODEX_HOME/config.toml`，不落盘 API key，变更前备份 |
| dry-run 密钥脱敏 | 已完成 | `CODEX_APP_PROVIDER_CLIPROXY_API_KEY=secret ... serve --dry-run --json` 输出 `OPENAI_API_KEY=<redacted>` |
| session resume/fallback contract | 已完成 | `internal/session/resume.go`；测试覆盖 resume、missing fallback、新建、保存失败 |
| approval 超时策略 | 已完成到 core contract | `internal/approval` 默认 `10m` 后返回 `expired`；确认/拒绝输入统一为 `confirm/reject` |
| 三端 approval 渲染/输入 contract | 已完成到平台输出和入站文本 contract；待真实交互 E2E | Telegram 输出 `inline_approval` + request/action 元数据；Weixin 输出 `approval_menu` + `1/2` 输入元数据；Lark 输出 `card_approval` + request/action 元数据；入站 `/approval-demo`、`/approve`、`/reject`、`1/2` 统一走 `internal/approval.Resolve`；`release-check` 内置 `approval.render` 与 `approval.input` 门禁 |
| 正式 serve 缺 channel 凭据 fail fast | 已完成 | `go run ./cmd/codex-app serve --addr 127.0.0.1:0` 返回 missing channel credentials |
| 导出 HTTP 启动入口不能绕过凭据检查 | 已完成 | `ServeHTTP` 内部也执行 `MissingChannelEnvError`；测试覆盖直接调用 |
| Hermes RenderEvent / DisplayProfile | 已完成到本地 contract | `internal/render`、三端 renderer 单测、`render-demo` smoke |
| Telegram 真实消息链路 | 已完成到 inbound auto-reply 证据 | `telegram token --json` 返回 `@ppx_codex_bot`；`telegram wait --write-env` 收到真实消息并写入 `TELEGRAM_CHAT_ID`；`release-check --smoke` 已发送成功；服务日志出现 `telegram message received` 与 `telegram message replied` |
| Weixin 真实消息链路 | 已完成到扫码/token/getupdates smoke；待最终 inbound auto-reply 证据 | iLink QR 已扫码确认；`qr-confirm --write-env` 可等待扫码并写入 `WEIXIN_ILINK_BOT_TOKEN`；`release-check --smoke` 证明 `getupdates` 可达；`weixin wait --reply` 可等待并回复真实入站消息 |
| Weixin token/send/update API | 已完成到 runtime/CLI | `internal/channel/weixin` 已接企业微信 `gettoken/message/send` 与 iLink `getupdates/sendmessage`；`weixin qr-wait --write-env` 可生成真实登录二维码、等待确认并写入本地 `.env` |
| Lark 真实消息链路 | 已完成最小闭环 | `lark token --json` 通过；Lark WebSocket connected；真实 Lark 消息出现 `message received` 和 `message replied` |
| 三端服务态 | 已完成到机器门禁 | `/health` 显示 `lark_ws_status=connected`、`telegram_polling_status=running`、`weixin_polling_status=running`；`release-check --smoke` 内置 `service.health` |
| 发布门禁 | 已完成到机器可读检查；最终 E2E 门禁仍 blocked | `release-check --json --smoke --strict-exit` 覆盖 config、approval.render/input、Lark token、Telegram token/chat/smoke、Weixin iLink/smoke、service.health；`release-check --json --smoke --require-e2e --strict-exit` 当前真实输出 `ok=false`，阻塞在 `weixin.inbound_e2e` 与 `approval.real_e2e` |
| 发布解锁入口 | 已完成 | `release-unblock --json` 一次输出 Telegram bot/deep link、临时 Weixin QR、当前 QR 确认命令、微信最终 E2E 等待命令、一键串联 `weixin_full_e2e` 和 `--require-e2e` 最终发布门禁；QR 有效期很短，必须以实时命令输出为准，不在文档固化链接 |
| Phase 8 删除 TS legacy | 已进入 Go-only 工作树 | `packages/`、`package.json`、`bun.lock`、`tsconfig.json` 已从当前工作树删除；当前测试与 CLI 不依赖 Bun/TS 主线 |

## 已执行验证

```bash
go test ./...
go run ./cmd/codex-app --help
go run ./cmd/codex-app doctor
go run ./cmd/codex-app serve --dry-run --json
go run ./cmd/codex-app serve --addr 127.0.0.1:0
CODEX_APP_PROVIDER_CLIPROXY_API_KEY=secret go run ./cmd/codex-app serve --dry-run --json
go run ./cmd/codex-app lark token --json
go run ./cmd/codex-app telegram token --json
go run ./cmd/codex-app telegram updates --json --limit 3
go run ./cmd/codex-app telegram wait --json --timeout 30 --write-env
go run ./cmd/codex-app weixin qr --json
go run ./cmd/codex-app weixin qr-wait --timeout 180 --write-env
go run ./cmd/codex-app weixin qr-confirm --json --qrcode <qrcode> --timeout 180 --write-env
go run ./cmd/codex-app weixin token --json
go run ./cmd/codex-app weixin wait --json --timeout 120 --reply --write-e2e --until-approval
go run ./cmd/codex-app release-check --json --smoke --strict-exit
go run ./cmd/codex-app release-evidence mark --json --telegram-inbound
go run ./cmd/codex-app release-check --json --smoke --require-e2e --strict-exit
go run ./cmd/codex-app serve --addr 127.0.0.1:8787
curl -sS http://127.0.0.1:8787/health
graphify update .
```

## 剩余强验收项

1. Weixin 需要由用户客户端在 iLink 会话发 `/approval-demo`，收到菜单后发 `1` 或 `2`；`weixin wait --reply --write-e2e --until-approval` 成功后会写入 `CODEX_APP_E2E_WEIXIN_INBOUND=true` 与 `CODEX_APP_E2E_APPROVAL_REAL=true`。
2. Telegram 已出现 inbound auto-reply 日志；后续只需保留为回归证据，不再是 blocker。
3. 三端 approval 真实点击/回复交互仍需平台 E2E 覆盖；core contract、三端渲染 contract、入站文本 contract 已完成；最终门禁以 `--require-e2e` 为准。

## 策略硬化记录

| 轮次 | 漏洞 | 修复 | 验证 |
|---|---|---|---|
| 1 | `StartContext` 已做 channel 凭据 fail-fast，但导出的 `ServeHTTP` 可被直接调用并绕过检查。 | 在 `ServeHTTP` 开头重复执行 `runtime.MissingChannelEnvError`。 | `TestServeHTTPRequiresChannelCredentials` |
| 1 | dry-run 密钥脱敏标记在 JSON 中可能被编码为 `\u003c...`，人工审计不直观。 | 统一使用 `SetEscapeHTML(false)` 输出 dry-run JSON。 | `TestDryRunRedactionUsesReadableMarker` |
| 1 | PRD 总目标包含真实三端 E2E，单元测试和 dry-run 不能替代真实平台验收。 | 明确把 TG / Weixin / Lark E2E 标为外部环境阻塞，不纳入本地完成项。 | 本文验收映射与阻塞项 |
| 2 | CLI `--json` 路径使用独立的 `command.printJSON`，仍会把 `<redacted>` 输出为 `\u003c...`。 | `command.printJSON` 同步关闭 HTML escape。 | `TestRunServeDryRunJSON` 和 CLI smoke |
| 3 | 本执行状态文档未挂到架构导航，后续 agent 可能只读 `docs/architecture/README.md` 而漏掉阻塞结论。 | 在架构导航中加入 `PRD 执行状态`。 | `rg codex-app-prd-execution-status docs/architecture/README.md` |
| 4 | Telegram 没有服务态入口，只能手动调用 runtime。 | 新增 Telegram long polling runner，`serve` 自动启动 polling 并回复。 | `/health` 中 `telegram_polling_status=running` |
| 4 | Weixin runtime 只是 stub，不能证明企业微信 API 边界。 | 接入企业微信 `gettoken` 与 `message/send`，并补 HTTP boundary 测试。 | `internal/channel/weixin` 单测；真实命令因缺 corp 凭据阻塞 |
| 5 | provider 写入策略未落地，只靠 launch env 不能满足 PRD 的 project-local `CODEX_HOME` 配置要求。 | 新增 provider config writer：dry-run 预览、正式写入 project-local `config.toml`、无 API key 落盘、变更备份。 | `internal/codex` 单测；`serve --dry-run --json` 输出 `provider_config` |
| 5 | approval 超时策略未定，会导致三端确认/拒绝语义分叉。 | 新增 core approval resolver，默认 10 分钟超时为 `expired`，数字/中英文确认拒绝统一归一。 | `internal/approval` 单测 |
| 6 | Weixin 只有企业微信 app send/token，没有 iLink 接收侧，无法成为真实聊天入口。 | 移植 iLink `getupdates/sendmessage` 最小边界，新增 Weixin polling runner 与 `weixin updates`。 | `internal/channel/weixin` iLink HTTP boundary 单测；服务健康包含 `weixin_polling_status` |
| 6 | Weixin 缺 bot token 时只能等待外部提供，无法自助进入真实登录。 | 新增 `weixin qr`、`weixin qr-status --write-env`、`weixin qr-confirm --write-env` 与 `weixin qr-wait --write-env`，真实 iLink QR 接口可返回二维码，状态接口不打印 bot token，但确认后可写入本地 `.env`。 | `weixin qr --json` 真实返回 qrcode/qrcode_url；`qr-confirm` 可等待当前 QR；`.env` 已被 gitignore |
| 7 | Telegram 缺 chat_id 时还需要人工复制，真实回发验收容易卡住。 | 新增 `telegram wait --write-env`，长轮询等待真实消息并写入本地 `.env`；`telegram token --json` 返回 username 方便定位 bot。 | `telegram wait --write-env` 收到真实消息并写入 `TELEGRAM_CHAT_ID` |
| 8 | 三端发布态缺少统一机器门禁，容易把单测通过误判为目标完成。 | 新增 `release-check --json --smoke --strict-exit`，把 config、Lark、Telegram、Weixin 发布 gate 合并成一个 `ok=false/true` 报告；optional corp send 缺失只记 `warn`，`--smoke` 会在有 chat/token 后做真实轻量平台调用，`--strict-exit` 可用于 CI/发布脚本失败退出。 | 当前真实输出：Lark token、Telegram token/chat/smoke、Weixin iLink/smoke 均 ok |
| 9 | `release-check ok=true` 仍不能证明 inbound auto-reply，容易再次把平台主动发送 smoke 当成完整 E2E。 | Telegram/Weixin polling 成功处理时新增 `message received/replied` 结构化日志，用服务日志作为最终强验收证据。 | 待客户端真实消息触发 |
| 10 | 结构化 approval event 在 `Text` 为空时会被 `ApplyProfile` 过滤；Telegram 混合事件中 approval block 会被普通 blocks 覆盖，导致 sample smoke 看不见 approval。 | `ApplyProfile` 保留结构化 approval；Telegram renderer 统一追加 blocks；三端 approval 渲染均带 request/action 元数据。 | `go test ./internal/render ./internal/channel/...`; `render-demo --channel all --json` 出现 `inline_approval`、`approval_menu`、`card_approval` |
| 11 | `approval.render` 只靠单独 smoke，未进入统一发布门禁，后续可能再次被漏过。 | `release-check` 新增 `approval.render`，检查 Telegram / Weixin / Lark 的 approval block、request_id 和 confirm/reject 元数据。 | `release-check --json --smoke --strict-exit` 输出 `approval.render: ok` |
| 12 | `/health` 里 Lark WS 在 SDK 真正连接前就显示 `running`，service health 可能过早绿灯。 | Lark WS 状态改为 `connecting -> connected`；只有 SDK 日志出现 `connected to ...` 才进入 `connected`；`release-check` 的 `service.health` 等待 `lark_ws=connected`。 | `release-check --json --smoke --strict-exit` 输出 `service.health: ok` 且 detail 为 `lark_ws=connected telegram_polling=running weixin_polling=running` |
| 13 | 微信最终入站验收只能靠完整 `serve` 盯日志，操作成本高且失败反馈不结构化。 | 新增 `weixin wait --timeout <seconds> --reply --write-e2e --until-approval`，等待 iLink 入站消息并可自动回复；成功时写 `CODEX_APP_E2E_WEIXIN_INBOUND=true`，`--until-approval` 会继续等待直到 approval confirm/reject，并写 `CODEX_APP_E2E_APPROVAL_REAL=true`；短等待超时返回稳定 JSON。 | `weixin wait --json --timeout 2 --reply --write-e2e --until-approval` 返回 `ok:false` / `weixin wait timed out` |
| 14 | approval 的 confirm/reject 只在 renderer 和 core resolver，真实平台入站消息没有统一入口。 | `kernel.HandleIncomingMessage` 新增 `/approval-demo`、`/approve`、`/reject`、`1/2` 处理，按 chat 保存最近待处理 request，统一调用 `internal/approval.Resolve`。 | `go test ./internal/kernel`; `release-check --json --smoke --strict-exit` 输出 `approval.input: ok` |
| 15 | `release-check ok=true` 仍可能被当成最终完成，但真实入站 E2E 证据是人工外部触发项。 | 新增 `release-check --require-e2e`，显式检查 `telegram.inbound_e2e`、`weixin.inbound_e2e`、`approval.real_e2e` 证据位；新增 `release-evidence mark` 记录已观测证据到 `.env`。 | 当前最终门禁：Telegram inbound ok，Weixin inbound 与 approval real E2E blocked |
| 16 | `release-unblock` 仍输出旧的 QR/token 阶段命令，无法直接引导最终 E2E。 | `release-unblock` 新增 `weixin_e2e_wait`，最终门禁改为 `release-check --smoke --require-e2e --strict-exit`。 | `release-unblock --json` 输出 `weixin_e2e_wait` 与 `final_release_gate` |
| 17 | `weixin wait` 使用单次 iLink 长轮询时，网络/context deadline 会直接退出，导致真实等待被一次超时误杀。 | iLink 请求体显式携带 `longpolling_timeout_ms`；全局超时未到时，单次 `context deadline exceeded` 作为空轮询继续等待。 | `go test -count=1 ./internal/channel/weixin ./internal/command`；240 秒真实等待稳定跑满并返回 `ok:false` |
| 18 | `telegram wait --json` / `weixin wait --json` 超时时输出 `ok:false` 但退出码仍为 0，脚本可能误判成功。 | JSON 失败 payload 仍先输出，但命令返回非零错误。 | `TestRunTelegramWaitJSONTimeoutReturnsError`、`TestRunWeixinWaitJSONTimeoutReturnsError` |
| 19 | QR 有效期短，`release-unblock` 输出的静态 QR + 分段命令容易过期。 | 新增 `weixin qr-confirm --qrcode <qrcode> --write-env` 等待当前 QR 确认；`release-unblock` 的 `weixin_full_e2e` 使用同一个 QR，并串联最终 `weixin wait --write-e2e --until-approval`。 | `TestRunWeixinQRConfirmWritesEnv`、`TestReleaseUnblockCommandsPointAtFinalE2EGate` |
| 20 | `weixin_full_e2e` 初版使用 `cmd1 && set -a; source ...; cmd2`，分号优先级会导致 QR 失败后仍执行 `weixin wait`。 | 后半段包进 `sh -c '...'`，确保只有 `qr-wait` 成功后才进入最终 E2E wait。 | `TestReleaseUnblockCommandsPointAtFinalE2EGate` 检查 `&& sh -c` 且禁止 `&& set -a;` |
| 21 | iLink `getupdates` 空轮询也会返回 `get_updates_buf`，但旧实现只在有消息 update 时推进 cursor，可能导致长轮询状态停在旧 cursor。 | Weixin runtime 新增 `UpdatesPage`，命令与服务轮询在空结果时也保存 page cursor。 | `TestWeixinRuntimeILinkGetUpdatesPageKeepsEmptyCursor` |

## 当前结论

本地 Alpha、Phase 0-4、provider 写入策略、approval core contract、三端 approval 渲染/输入 contract、Go-only 工作树、Lark 最小真实收发、Telegram token/chat/send smoke + inbound auto-reply、Weixin iLink 扫码/token/getupdates smoke、三端服务健康检查已经闭合。当前不能标记“三端完整发布态”完成：`release-check --json --smoke --require-e2e --strict-exit` 仍因 `weixin.inbound_e2e` 与 `approval.real_e2e` blocked 退出失败。

## 交接未完成项

当前未完成项只有真实微信客户端入站与真实 approval E2E：

1. 运行 `go run ./cmd/codex-app release-unblock --json` 获取实时 `weixin_qrcode_url` 与 `weixin_full_e2e`。
2. 打开 `weixin_qrcode_url` 并扫码确认；`weixin_full_e2e` 会等待当前 QR，写入 `WEIXIN_ILINK_BOT_TOKEN`。
3. 在扫码后的微信 iLink 机器人会话发送 `/approval-demo`。
4. 收到回复后发送 `1` 或 `2`。
5. 成功后 `.env` 会写入 `CODEX_APP_E2E_WEIXIN_INBOUND=true` 与 `CODEX_APP_E2E_APPROVAL_REAL=true`。
6. 最终以 `go run ./cmd/codex-app release-check --json --smoke --require-e2e --strict-exit` 作为完成判定；该命令通过前不能把 `$nova-goal 实现 三端完整发布态` 标记完成。

最近一次事实结果：2026-05-10 05:10 左右，QR 扫码确认和 token 写入已经成功；随后 `weixin wait --json --timeout 240 --reply --write-e2e --until-approval` 因 240 秒内未收到微信会话消息而超时。
