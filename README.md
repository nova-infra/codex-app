# Codex App

统一的 Codex 服务层，为 RN App / Telegram / 微信提供 AI 编程能力。包装 OpenAI `codex app-server`，通过 WebSocket 代理 JSON-RPC 协议。

## 架构

```
RN App ──ws──▸ codex-app server ──ws──▸ codex app-server
TG Bot ──long polling──▸ server
微信 ──iLink polling──▸ server
```

- 无需公网 IP，无需穿透
- 单机部署，单进程管理 codex 生命周期
- RN App 局域网直连，TG / 微信均为主动拉取

## 前置条件

- [Bun](https://bun.sh/) >= 1.0
- [Codex CLI](https://github.com/openai/codex) (`npm install -g @openai/codex`)
- Codex CLI 已登录（`codex login`）

## 安装

```bash
git clone https://github.com/nova-infra/codex-app.git
cd codex-app
bun install
```

## 启动

```bash
bun run dev
```

首次启动自动创建管理员用户和 Token，输出到终端：

```
[codex-app] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[codex-app]   首次启动，已自动创建管理员
[codex-app]   用户: admin
[codex-app]   Token: a3f8c1...b7c2d9
[codex-app] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[codex-app] Ready at http://localhost:8765
```

无需手动编辑配置文件，开箱即用。

## 配置

配置文件位于 `~/.codex-app/config.json`，首次启动自动创建。

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
    { "token": "your-token", "userId": "u1", "label": "default" }
  ],
  "telegram": {
    "botToken": "your-telegram-bot-token"
  },
  "wechat": {
    "enabled": true
  }
}
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `port` | 服务端口，默认 8765 |
| `codex.port` | codex app-server 内部端口，默认 8766 |
| `codex.model` | 默认模型 |
| `codex.approvalPolicy` | 工具调用审批策略：`never`（全自动）、`auto-edit`、`always` |
| `codex.sandbox` | 沙箱模式 |
| `users` | 用户列表。`id` 是稳定标识（不可变），`name` 是显示名 |
| `tokens` | 认证凭证。`userId` 指向用户 ID。一个用户可以有多个 Token，Token 可轮换不影响会话 |
| `telegram.botToken` | Telegram Bot Token。不配则不启动 TG 通道 |
| `wechat.enabled` | 是否启动微信通道。不配或 `false` 则不启动 |

运行时数据（`sessions.json`、`channels.json`、`tg-threads.json`）也存储在 `~/.codex-app/` 下。

## Telegram Bot 设置

### 1. 创建 Bot

1. 在 Telegram 搜索 [@BotFather](https://t.me/BotFather)
2. 发送 `/newbot`，按提示设置名称
3. 获得 Bot Token（格式：`123456:ABC-DEF...`）

### 2. 配置

将 Token 填入 `~/.codex-app/config.json`：

```json
{
  "telegram": {
    "botToken": "123456:ABC-DEF..."
  }
}
```

### 3. 启动并使用

```bash
bun run dev
```

在 Telegram 中给你的 Bot 发消息：
- **单用户**：自动绑定，直接可用
- **多用户**：Bot 会要求发送 Token 完成绑定

### 4. 命令

| 命令 | 说明 |
|------|------|
| `/new` | 新建会话 |
| `/session` | 切换会话（Inline Keyboard） |
| `/project <路径>` | 设置项目目录 |
| `/model` | 选择模型（Inline Keyboard） |
| `/reasoning` | 设置推理深度 |
| `/status` | 查看当前状态 |
| `/help` | 查看命令列表 |
| `/token` | 查看当前 Token（仅管理员） |
| `/token create <名称>` | 创建新用户和 Token |
| `/token list` | 列出所有用户 |
| `/token revoke <token>` | 吊销 Token |

### 5. 特性

- **工具进度展示**：执行命令、修改文件等操作实时显示（💭 Thinking / 🔧 命令 / 📝 文件修改）
- **HTML 格式化**：回复支持粗体、代码块、链接等格式
- **Inline Keyboard**：会话切换、模型选择、Context 警告等交互
- **Context 管理**：上下文使用率超过 80% 时自动提示压缩或新建会话

## 微信设置

微信通道使用 iLink Bot 协议（轻量模式）：

1. 在 `config.json` 中设置 `"wechat": { "enabled": true }`
2. 启动后终端打印 QR 码 URL，用微信扫码登录
3. 首次发消息需绑定（单用户自动绑定）

微信限制：
- 纯文本模式，无 Markdown 渲染
- Approval 通过数字菜单确认（回复 1 确认，2 拒绝）
- 消息长度限制 4000 字符，自动分块发送

## WebSocket API（RN App）

连接地址：

```
ws://localhost:8765/ws?token=<your-token>
```

透传 `codex app-server` 的 JSON-RPC 协议。Server 层提供 Token 校验、用户隔离和 Session 归属映射。

### 示例

安装 websocat 测试：

```bash
brew install websocat
websocat ws://localhost:8765/ws?token=your-token
```

```json
// 列出会话
{"jsonrpc":"2.0","id":1,"method":"thread/list","params":{}}

// 创建会话
{"jsonrpc":"2.0","id":2,"method":"thread/start","params":{"cwd":"/path/to/project"}}

// 恢复会话
{"jsonrpc":"2.0","id":3,"method":"thread/resume","params":{"threadId":"xxx","cwd":"/path/to/project"}}

// 发送消息
{"jsonrpc":"2.0","id":4,"method":"turn/start","params":{"threadId":"xxx","input":[{"role":"user","content":"hello"}]}}

// 中断生成
{"jsonrpc":"2.0","id":5,"method":"turn/interrupt","params":{"threadId":"xxx"}}

// 压缩上下文
{"jsonrpc":"2.0","id":6,"method":"thread/compact/start","params":{"threadId":"xxx"}}

// 健康检查
curl http://localhost:8765/health
```

所有 codex app-server 支持的 JSON-RPC 方法均可使用。

## 包结构

```
codex-app/
├── packages/
│   ├── core/                     # @codex-app/core
│   │   └── src/
│   │       ├── bridge/           # CodexClient (WebSocket JSON-RPC)
│   │       ├── session/          # SessionManager + SessionStore
│   │       ├── auth/             # TokenGuard
│   │       ├── notify/           # NotificationHub
│   │       └── config.ts         # 配置加载 + Token 管理
│   │
│   ├── server/                   # @codex-app/server
│   │   └── src/
│   │       ├── index.ts          # 入口：启动 codex + HTTP + WS + channels
│   │       └── ws/wsProxy.ts     # WS 代理：JSON-RPC 透传 + 权限过滤
│   │
│   ├── channel-telegram/         # @codex-app/channel-telegram
│   │   └── src/
│   │       ├── polling.ts        # TG getUpdates long polling
│   │       ├── sender.ts         # Bot API 封装
│   │       ├── adapter.ts        # 消息转换 + 命令 + 工具进度
│   │       └── format.ts         # Markdown → TG HTML
│   │
│   └── channel-wechat/           # @codex-app/channel-wechat
│       └── src/
│           ├── polling.ts        # iLink long polling + QR 登录
│           ├── sender.ts         # iLink 发消息 + CDN
│           ├── adapter.ts        # 消息转换 + 命令
│           ├── cdnCrypto.ts      # AES-128-ECB 媒体加解密
│           └── textFormat.ts     # Markdown → 纯文本
│
├── package.json                  # Bun workspace root
└── tsconfig.json
```

### 依赖关系

```
server ──▸ core
channel-telegram ──▸ core
channel-wechat ──▸ core
core 不依赖任何 channel，channel 之间不互相依赖
```

## 构建部署

```bash
# 开发模式
bun run dev

# 编译为单文件二进制
bun run build

# 运行二进制
./codex-app-server
```

### 部署注意事项

- **必须提供 `OPENAI_API_KEY`**。否则 `codex app-server` 无法启动，并会报错：
  - `Missing environment variable: OPENAI_API_KEY`
- **编译版不要把 channel 启动改回动态 `import('@codex-app/channel-*')`**。
  `bun build --compile` 下，这类 workspace 动态 import 可能不会被正确打进二进制，运行时会出现：
  - `Cannot find module '@codex-app/channel-telegram'`
  - `Cannot find module '@codex-app/channel-wechat'`
- 这两个坑都已经反复出现过，部署和重构时都要保留当前做法。

### systemd 示例

```ini
[Unit]
Description=Codex App Server
After=network.target

[Service]
Type=simple
ExecStart=/opt/codex-app/codex-app-server
WorkingDirectory=/opt/codex-app
Environment=OPENAI_API_KEY=your-openai-api-key
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
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
| 部署 | bun build --compile → 单文件二进制 |

## FAQ

### 首次启动做了什么？

自动创建 `~/.codex-app/config.json`，生成一个管理员用户（admin）和随机 Token，打印到终端。

### Token 怎么管理？

- 首次启动自动生成
- 通过 TG Bot 的 `/token create <名称>` 创建新用户和 Token
- `/token list` 查看所有用户
- `/token revoke <token>` 吊销 Token
- 也可以直接编辑 `~/.codex-app/config.json`

### 多用户怎么用？

每个 Token 对应一个 User ID，会话按 User ID 隔离。一个用户可以有多个 Token（如 App 一个、API 一个），共享同一份会话。TG/微信绑定的是 User ID，换 Token 不影响绑定关系。

### 会话怎么持久化？

会话数据由 `codex app-server` 管理，存储在 `~/.codex/` 下。codex-app 只存储 session-user 映射（`~/.codex-app/sessions.json`）和 TG/WX channel 绑定（`channels.json`）。PC 端 Codex CLI 和 codex-app 共享同一份会话数据。

### 重启后会话还在吗？

在。TG 的 chat → thread 映射持久化到 `~/.codex-app/tg-threads.json`，重启后自动恢复并 resume。

### codex 的 approval_policy 怎么选？

- `never` — 全自动，不弹确认（推荐自用）
- `auto-edit` — 文件操作自动，命令执行需确认
- `always` — 所有工具调用都需确认（通过 TG Inline Keyboard 或微信数字菜单）

## 许可证

MIT
