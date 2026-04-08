# Codex App Workspace

统一的 Codex 服务层，为 RN App / Telegram / 微信提供 AI 编程能力。

## 文档路由

| 需要了解 | 读这个 |
|---------|--------|
| 完整设计文档 | `docs/specs/2026-04-08-codex-app-design.md` |
| 可复用代码索引 | 同上，末尾"可复用代码索引"章节 |
| 复用源码 | `/Users/Bigo/Desktop/develop/nova-infra/codexui/server/` |

## 架构概览

```
RN App ──ws──▸ codex-app server ──ws──▸ codex app-server (单实例)
TG Bot ──long polling──▸ server
微信 ──iLink long polling──▸ server
```

无需公网 IP，无需穿透。

## 包职责

| 包 | 路径 | 说明 |
|---|---|---|
| `@codex-app/core` | `packages/core/` | CodexClient (ws bridge)、SessionManager、TokenGuard、NotificationHub、Config |
| `@codex-app/server` | `packages/server/` | Bun.serve 入口、WS 代理、启动 channel polling |
| `@codex-app/channel-telegram` | `packages/channel-telegram/` | TG Bot：long polling、inline keyboard、editMessageText 流式 |
| `@codex-app/channel-wechat` | `packages/channel-wechat/` | 微信 iLink：long polling、CDN crypto、纯文本适配 |

## 包依赖

```
server ──▸ core
channel-telegram ──▸ core
channel-wechat ──▸ core
core 不依赖任何 channel
channel 之间不互相依赖
```

## 开发规范

- 运行时: Bun
- 语言: TypeScript (strict)
- **不写单测，不跑 tsc 类型检查**
- **开发阶段直接 `bun run`，不需要 build**
- 仅发布时 `bun build --compile` 生成二进制
- 不可变数据: 禁止 mutation，所有操作返回新对象
- 文件上限: 400 行，函数上限: 50 行
- 错误处理: 显式处理，不吞异常

## Import 规范

```typescript
// 包内引用：统一用 @/ alias 指向 src/
import type { CodexClient } from '@/bridge/codexClient'
import { SessionStore } from '@/session/sessionStore'

// 跨包引用：用 workspace 包名
import { CodexClient, SessionManager } from '@codex-app/core'
```

禁止出现 `../../` 形式的相对路径。

## 提交规范

```
<type>: <description>
```

类型: feat, fix, refactor, docs, chore

## 快速开始

### 1. 配置

编辑 `~/.codex-app/config.json`：

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
    { "id": "u1", "name": "主力" }
  ],
  "tokens": [
    { "token": "my-main", "userId": "u1", "label": "调试" }
  ],
  "telegram": {
    "botToken": "你的TG Bot Token（可选）"
  },
  "wechat": {
    "enabled": true
  }
}
```

配置说明：
- `users` — 用户列表，id 是稳定标识
- `tokens` — 认证凭证，userId 指向 users.id，可为同一用户创建多个
- `telegram.botToken` — 不配则不启动 TG channel
- `wechat.enabled` — 不配或 false 则不启动微信 channel

运行时数据（sessions.json、channels.json）也存储在 `~/.codex-app/` 下。

### 2. 启动

```bash
# 安装依赖
bun install

# 开发模式（直接跑，不需要 build）
bun run dev

# 编译为单文件二进制
bun run build
./codex-app-server
```

启动成功输出：
```
[codex-app] Loading config from ~/.codex-app/config.json
[codex-app] Port: 8765, Codex port: 8766
[codex-app] Codex app-server connected
[codex-app] Ready at http://localhost:8765
[codex-app] WebSocket: ws://localhost:8765/ws?token=<your-token>
```

### 3. 验证

```bash
# 健康检查
curl http://localhost:8765/health

# WebSocket 连接测试（需安装 websocat: brew install websocat）
websocat ws://localhost:8765/ws?token=my-main

# 连上后发 JSON-RPC 列出会话
{"jsonrpc":"2.0","id":1,"method":"thread/list","params":{}}

# 创建会话（指定项目目录）
{"jsonrpc":"2.0","id":2,"method":"thread/start","params":{"cwd":"/path/to/project"}}

# 发消息
{"jsonrpc":"2.0","id":3,"method":"turn/start","params":{"threadId":"xxx","input":[{"role":"user","content":"hello"}]}}
```

### 4. Telegram 调试

1. 从 @BotFather 创建 Bot，获取 token
2. 填入 config.json 的 `telegram.botToken`
3. `bun run dev` 启动
4. 在 TG 给 Bot 发消息，首次会要求输入 token 绑定
5. 绑定后即可对话，支持 inline keyboard、流式输出

### 5. 微信调试

1. config.json 设置 `"wechat": { "enabled": true }`
2. `bun run dev` 启动
3. 终端会打印 QR 码 URL，用微信扫码登录
4. 首次发消息需输入 token 绑定
5. 绑定后即可对话（纯文本模式）

## 复用代码须知

从 codexui 复用代码时：
1. 先读设计文档中的"可复用代码索引"确认复用级别 (copy/adapt/reference)
2. copy 级别：直接复制，只改 import 路径
3. adapt 级别：核心逻辑可用，需改接口适配
4. 复制后确保符合本项目 import 规范 (`@/` alias)
5. 复制后文件不超过 400 行，超过则拆分
