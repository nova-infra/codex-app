# 快速启动

## 最小启动

```bash
go run ./cmd/codex-app doctor
go run ./cmd/codex-app serve --dry-run
go run ./cmd/codex-app serve --addr 127.0.0.1:8787
```

## 验证服务

```bash
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/version
curl 'http://127.0.0.1:8787/render-demo?channel=all'
```

## 说明

- 当前仓库是 Go-only 主线，入口为 `cmd/codex-app`。
- 常规验证使用 `go test ./...` 和上面的 smoke 命令。
- 详细约束、模块职责和开发规范统一看 `AGENTS.md`。
- 架构和后续重构方向统一看 `docs/architecture/`。

## Lark 真实消息链路

启动前设置环境变量（不要写入仓库）：

```bash
export LARK_APP_ID="<app-id>"
export LARK_APP_SECRET="<app-secret>"
export LARK_API_BASE="https://open.larksuite.com"
# 可选：如果 Lark 事件订阅配置了 Verification Token
export LARK_VERIFICATION_TOKEN="<verification-token>"
```

验证 token：

```bash
go run ./cmd/codex-app lark token
```

启动服务：

```bash
go run ./cmd/codex-app serve --addr 127.0.0.1:8787
```

默认启动 Lark WebSocket 长连接模式，本地服务无需公网回调即可接收事件。若需要 HTTP webhook 模式，也可以在 Lark 开放平台事件订阅中把 Request URL 指向公网可访问的：

```text
POST /lark/events
```

如需临时关闭 WebSocket 模式：

```bash
export LARK_WS_DISABLED=true
```

本地主动发消息 smoke：

```bash
curl -X POST http://127.0.0.1:8787/lark/send \
  -H 'Content-Type: application/json' \
  -d '{"chat_id":"oc_xxx","text":"hello"}'
```
