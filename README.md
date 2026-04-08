# Codex App

Unified Codex server for RN App, Telegram, and WeChat. Wraps `codex app-server` via WebSocket JSON-RPC — no new protocol invented.

## Architecture

```
RN App ──ws──▸ codex-app server ──ws──▸ codex app-server
TG Bot ──long polling──▸ server
WeChat ──iLink polling──▸ server
```

No public IP required. No tunneling.

## Quick Start

```bash
# Install
bun install

# Run (first start auto-creates admin user + token)
bun run dev
```

First launch output:

```
[codex-app] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[codex-app]   首次启动，已自动创建管理员
[codex-app]   用户: admin
[codex-app]   Token: a3f8...b7c2
[codex-app] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Configuration

`~/.codex-app/config.json`:

```json
{
  "port": 8765,
  "codex": {
    "port": 8766,
    "model": "o3",
    "approvalPolicy": "never",
    "sandbox": "danger-full-access"
  },
  "users": [
    { "id": "u1", "name": "admin" }
  ],
  "tokens": [
    { "token": "my-main", "userId": "u1", "label": "RN App" }
  ],
  "telegram": {
    "botToken": "your-bot-token"
  },
  "wechat": {
    "enabled": true
  }
}
```

## Telegram Bot

1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Add `botToken` to config
3. `bun run dev`
4. Send a message to your bot — single user auto-binds, no token needed

### Commands

| Command | Description |
|---------|-------------|
| `/new` | New session |
| `/session` | Switch session |
| `/project <path>` | Set working directory |
| `/model` | Select model |
| `/reasoning` | Set reasoning depth |
| `/token` | Manage tokens (admin) |
| `/token create <name>` | Create new user + token |
| `/token list` | List all users |
| `/token revoke <token>` | Revoke a token |
| `/status` | Current status |
| `/help` | Show commands |

### Features

- Tool progress display (thinking, commands, file edits)
- HTML formatted responses (bold, code blocks, links)
- Inline keyboard for session/model selection
- Context usage warnings with action buttons

## WebSocket API (RN App)

```
ws://localhost:8765/ws?token=<your-token>
```

Transparent JSON-RPC proxy to `codex app-server`. All codex methods available:

```json
{"jsonrpc":"2.0","id":1,"method":"thread/list","params":{}}
{"jsonrpc":"2.0","id":2,"method":"thread/start","params":{"cwd":"/path/to/project"}}
{"jsonrpc":"2.0","id":3,"method":"turn/start","params":{"threadId":"xxx","input":[{"role":"user","content":"hello"}]}}
```

## Packages

| Package | Description |
|---------|-------------|
| `@codex-app/core` | CodexClient, SessionManager, TokenGuard, NotificationHub |
| `@codex-app/server` | Bun.serve entry, WS proxy, channel orchestration |
| `@codex-app/channel-telegram` | TG Bot: polling, inline keyboard, HTML formatting |
| `@codex-app/channel-wechat` | WeChat: iLink polling, CDN crypto, plain text mode |

## Build

```bash
# Compile to single binary
bun run build
./codex-app-server
```

## Tech Stack

| Layer | Tech |
|-------|------|
| Runtime | Bun |
| Language | TypeScript |
| HTTP/WS | Bun.serve |
| Codex bridge | codex app-server (WebSocket JSON-RPC) |
| Storage | JSON files (~/.codex-app/) |
| TG Bot | Telegram Bot API (long polling) |
| WeChat | iLink Bot Protocol (long polling) |

## License

MIT
