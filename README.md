# Codex App

统一的 Codex 服务层，为 RN App / Telegram / 微信提供 AI 编程能力。通过 WebSocket 代理 `codex app-server` 的 JSON-RPC 协议，不发明新协议。

## 架构

```
RN App ──ws──▸ codex-app server ──ws──▸ codex app-server
TG Bot ──long polling──▸ server
微信 ──iLink polling──▸ server
```

无需公网 IP，无需穿透。

## 快速开始

```bash
# 安装依赖
bun install

# 启动（首次自动创建管理员和 Token）
bun run dev
```

首次启动输出：

```
[codex-app] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[codex-app]   首次启动，已自动创建管理员
[codex-app]   用户: admin
[codex-app]   Token: a3f8...b7c2
[codex-app] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 配置

`~/.codex-app/config.json`：

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
    "botToken": "你的 Bot Token"
  },
  "wechat": {
    "enabled": true
  }
}
```

配置说明：
- `users` — 用户列表，`id` 是稳定标识，永不变更
- `tokens` — 认证凭证，`userId` 指向用户，可为同一用户创建多个，支持轮换
- `telegram.botToken` — 不配则不启动 Telegram 通道
- `wechat.enabled` — 不配或 `false` 则不启动微信通道

运行时数据（`sessions.json`、`channels.json`）存储在 `~/.codex-app/` 下。

## Telegram Bot

1. 通过 [@BotFather](https://t.me/BotFather) 创建 Bot，获取 Token
2. 填入 `config.json` 的 `telegram.botToken`
3. `bun run dev` 启动
4. 给 Bot 发消息 — 单用户自动绑定，无需手动输入 Token

### 命令

| 命令 | 说明 |
|------|------|
| `/new` | 新建会话 |
| `/session` | 切换会话 |
| `/project <路径>` | 设置项目目录 |
| `/model` | 选择模型 |
| `/reasoning` | 设置推理深度 |
| `/token` | 管理 Token（仅管理员） |
| `/token create <名称>` | 创建新用户 + Token |
| `/token list` | 列出所有用户 |
| `/token revoke <token>` | 吊销 Token |
| `/status` | 查看状态 |
| `/help` | 查看命令 |

### 特性

- 工具调用进度展示（Thinking、命令执行、文件修改等）
- HTML 格式化回复（粗体、代码块、链接）
- Inline Keyboard 交互（会话选择、模型切换、Context 警告）
- 单用户自动绑定，多用户 Token 绑定

## 微信

轻量模式：
- 纯文本对话 + 斜杠命令
- Approval 通过数字菜单确认（回复 1 确认，2 拒绝）
- Markdown 自动转纯文本
- iLink 协议，QR 扫码登录

## WebSocket API（RN App）

```
ws://localhost:8765/ws?token=<your-token>
```

透传 `codex app-server` 的 JSON-RPC 协议，所有 codex 方法可用：

```json
{"jsonrpc":"2.0","id":1,"method":"thread/list","params":{}}
{"jsonrpc":"2.0","id":2,"method":"thread/start","params":{"cwd":"/path/to/project"}}
{"jsonrpc":"2.0","id":3,"method":"turn/start","params":{"threadId":"xxx","input":[{"role":"user","content":"hello"}]}}
```

Server 层提供：
- Token 校验 + 用户隔离
- Session 归属映射
- JSON-RPC 权限过滤

## 包结构

| 包 | 说明 |
|---|------|
| `@codex-app/core` | CodexClient（WS 桥接）、SessionManager、TokenGuard、NotificationHub |
| `@codex-app/server` | Bun.serve 入口、WS 代理、Channel 编排 |
| `@codex-app/channel-telegram` | TG Bot：Long Polling、Inline Keyboard、HTML 格式化 |
| `@codex-app/channel-wechat` | 微信：iLink Polling、CDN Crypto、纯文本适配 |

### 依赖关系

```
server ──▸ core
channel-telegram ──▸ core
channel-wechat ──▸ core
core 不依赖任何 channel
channel 之间不互相依赖
```

## 构建部署

```bash
# 编译为单文件二进制
bun run build
./codex-app-server
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Bun |
| 语言 | TypeScript |
| HTTP/WS | Bun.serve（原生） |
| Codex 桥接 | codex app-server（WebSocket JSON-RPC） |
| 持久化 | JSON 文件（~/.codex-app/） |
| TG Bot | Telegram Bot API（Long Polling） |
| 微信 | iLink Bot Protocol（Long Polling） |

## 许可证

MIT
