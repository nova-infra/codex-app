# Codex App Workspace - 设计文档

## 概述

统一的 Codex 服务层，为 RN App / Telegram / 微信提供 AI 编程能力。包装 `codex app-server`，通过 WebSocket 代理 JSON-RPC 协议，不发明新协议。

## 架构

### 整体数据流

```
RN App ──ws (局域网)──▸ codex-app server ──ws──▸ codex app-server (单实例)
                              │
TG Bot ──long polling──▸      │ (同一服务层)
                              │
微信 ──iLink long polling──▸  │
```

不需要公网 IP，不需要穿透。RN App 局域网直连，TG 和微信都是主动拉取消息。

### 分层

```
┌──────────────────────────────────────────────────────────┐
│                    Transport Layer                        │
│  ┌────────────┐  ┌────────────────┐  ┌────────────────┐  │
│  │ WS Proxy   │  │ TG Polling     │  │ WX iLink       │  │
│  │ (RN App)   │  │ (getUpdates)   │  │ (getUpdates)   │  │
│  └──────┬─────┘  └──────┬─────────┘  └──────┬─────────┘  │
│         └───────────┬───┘───────────────────┘             │
│                     ▼                                     │
│            ┌──────────────┐                               │
│            │  Token Guard │                               │
│            └──────┬───────┘                               │
│                   ▼                                       │
├──────────────────────────────────────────────────────────┤
│                   Service Layer                           │
│  ┌──────────────────┐  ┌──────────────────────────┐       │
│  │ SessionManager   │  │ NotificationHub          │       │
│  │ (会话生命周期)     │  │ (codex通知 → 路由到终端)  │       │
│  └────────┬─────────┘  └──────────────────────────┘       │
├───────────┼──────────────────────────────────────────────┤
│           ▼         Bridge Layer                          │
│  ┌──────────────────────────────────────────────┐         │
│  │ CodexClient                                  │         │
│  │ 连接 codex app-server (ws://127.0.0.1:8766)  │         │
│  │ JSON-RPC 收发、通知分发                        │         │
│  └──────────────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────┘
```

### 设计原则

- CodexClient 是唯一和 codex app-server 通信的地方
- SessionManager 是唯一管理会话归属的地方
- NotificationHub 根据 session 反查 channel，推到正确的终端
- 每个 channel adapter 只负责协议转换，不碰业务逻辑
- 包间依赖: channel-* → core ← server，channel 之间不互相依赖

## 用户与认证

### User + Token 分离

```
User {
  id:     string    ← 稳定标识，永远不变
  name:   string
}

Token {
  token:  string    ← 凭证，可轮换、可多个
  userId: string    ← 指向 User.id
  label:  string
}
```

- User 是稳定身份，所有 session/channel 绑定都关联 userId
- Token 是认证凭证，可轮换、可为同一用户创建多个
- 换 token 不影响 session 和 channel 绑定
- config.json 中手动配置，无注册接口

### Channel 绑定

运行时自动持久化到 `~/.codex-app/channels.json`：

```
ChannelBinding {
  type:       "telegram" | "wechat"
  externalId: string  (tg chat_id / wx openid)
  userId:     string  (归属用户，不绑 token)
}
```

绑定流程（TG/WX 首次使用时）：
1. 用户首次发消息 → 未绑定
2. Bot 回复："请发送你的 token 完成绑定"
3. 用户发送 token → 校验存在 → 查到 userId → 写入 channels.json
4. 后续消息通过 externalId 查到 userId → 共享该用户所有会话

## 会话生命周期

### 概念模型

```
Project (项目目录)
  └── Session (codex thread)
        └── Turn (一次用户输入 → AI 完成输出)
```

### 各端行为

**RN App：**
- 打开 App → 展示项目列表
- 选择项目 → 自动进入该项目的最近活跃 session
- 发消息 → 直接续上
- 想开新会话 → UI 有入口但不强制
- 会话列表可浏览、可切回

**Telegram：**
- 每个 TG chat 绑定一个 (project, session) 组合
- 首次使用 → 引导选择项目目录 → 自动创建 session
- 后续消息 → 直接续当前 session
- 切项目 → `/project /path/to/xxx`
- 切会话 → `/session` 列出最近的，inline keyboard 选择
- Approval → inline keyboard 卡片确认
- 流式输出 → editMessageText 节流 (1-2次/秒)

**微信（轻量模式）：**
- 纯文本对话 + 基础斜杠命令
- Approval 用数字菜单（"回复 1 确认，2 拒绝"）
- Diff/代码输出做纯文本适配（strip markdown）
- 复杂操作引导到 RN App

### 不超时

会话永远续上，直到用户主动开新会话。codex thread 本身就是持久化的。

### Context 管理

```
context 使用率 > 80% (通过 thread/tokenUsage/updated 监听)
      │
      ▼
  推送提示给用户:
  ┌──────────────────────────────────────┐
  │ 当前会话上下文使用率 82%，建议处理：    │
  │ [压缩继续]  [开新会话]  [先不管]       │
  └──────────────────────────────────────┘

  App → 轻提示，用户点选
  TG  → inline keyboard 卡片
  WX  → 数字菜单

  用户不理会 → 不做操作
  真正 context_length_exceeded → 自动 compact + 重试（兜底）
```

## API 设计

### HTTP（最小化）

```
GET  /health               ← 健康检查
```

仅此一个 HTTP 端点。TG 和微信都用 long polling（主动拉取），不需要 webhook。

### WebSocket（核心通道）

```
ws://host:8765/ws?token=xxx
```

RN App 全部走 WebSocket，透传 codex app-server 的 JSON-RPC 协议。server 层只做：
- token 校验 + 用户隔离
- session-user 归属映射
- JSON-RPC 透传（加权限过滤）

### TG / 微信通道

不走 HTTP webhook，server 内部主动 polling：
- **TG**：启动时开始 `getUpdates` long polling，收到消息 → 转为 JSON-RPC 调用 → 结果通过 Bot API 推回
- **微信**：启动时开始 iLink `getupdates` long polling，收到消息 → 转为 JSON-RPC 调用 → 结果通过 iLink `sendmessage` 推回

### codex app-server JSON-RPC 方法（参考）

会话管理：
- thread/start (cwd 在此指定)
- thread/resume (cwd 可后置)
- thread/list
- thread/read
- thread/archive
- thread/compact/start

对话：
- turn/start
- turn/interrupt
- turn/steer

文件系统：
- fs/readFile, fs/readDirectory, fs/writeFile, fs/copy, fs/remove

配置：
- config/read, config/batchWrite
- model/list

通知（Server → Client）：
- item/agentMessage/delta (流式内容)
- item/completed
- turn/completed
- turn/started
- thread/tokenUsage/updated
- thread/compacted

Approval 请求（Server → Client）：
- ExecCommandApproval
- FileChangeRequestApproval
- ApplyPatchApproval

## 项目结构

```
codex-app/
├── AGENTS.md                     # 唯一入口：规范 + docs 路由表
├── docs/
│   ├── architecture.md           # 整体架构、数据流、技术选型
│   ├── packages/
│   │   ├── core.md
│   │   ├── server.md
│   │   ├── channel-telegram.md
│   │   └── channel-wechat.md
│   ├── specs/                    # 设计文档
│   └── deploy.md                 # 构建、部署、运维
│
├── packages/
│   ├── core/                     # @codex-app/core
│   │   ├── package.json
│   │   └── src/
│   │       ├── bridge/
│   │       │   └── codexClient.ts
│   │       ├── session/
│   │       │   ├── sessionManager.ts
│   │       │   └── sessionStore.ts
│   │       ├── auth/
│   │       │   └── tokenGuard.ts
│   │       ├── notify/
│   │       │   └── notificationHub.ts
│   │       └── config.ts
│   │
│   ├── server/                   # @codex-app/server
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts          # 入口：HTTP + WS + 启动 polling
│   │       └── ws/
│   │           └── wsProxy.ts
│   │
│   ├── channel-telegram/         # @codex-app/channel-telegram
│   │   ├── package.json
│   │   └── src/
│   │       ├── polling.ts        # TG getUpdates long polling
│   │       ├── sender.ts         # Bot API: sendMessage/editMessageText/inline keyboard
│   │       └── adapter.ts        # TG 消息 ↔ JSON-RPC 转换
│   │
│   └── channel-wechat/           # @codex-app/channel-wechat
│       ├── package.json
│       └── src/
│           ├── polling.ts        # iLink getupdates long polling
│           ├── sender.ts         # iLink sendmessage + CDN crypto
│           └── adapter.ts        # WX 消息 ↔ JSON-RPC 转换
│
├── package.json                  # workspace root
└── tsconfig.json
```

### Import 规范

包内使用 `@/` alias 指向 `src/`，避免相对路径：

```typescript
// 包内引用
import type { CodexClient } from '@/bridge/codexClient'
import { SessionStore } from '@/session/sessionStore'

// 跨包引用
import { CodexClient, SessionManager } from '@codex-app/core'
```

### 包依赖关系

```
server ──▸ core
channel-telegram ──▸ core
channel-wechat ──▸ core
core 不依赖任何 channel
```

## 启动流程

```
./codex-app-server --port 8765  (或 bun run dev)
      │
      ▼
1. 加载配置 (~/.codex-app/config.json)
      │
      ▼
2. spawn codex app-server --listen ws://127.0.0.1:8766
   等待 WebSocket 可连接
      │
      ▼
3. CodexClient 连接 ws://127.0.0.1:8766
   发送 initialize
      │
      ▼
4. Bun.serve (port 8765)
   ├── GET  /health
   └── WS   /ws?token=xxx
      │
      ▼
5. 启动 TG long polling (如果配置了 telegram.botToken)
      │
      ▼
6. 启动 WX iLink long polling (如果配置了 wechat.enabled)
      │
      ▼
✅ Ready — 无需公网 IP，无需穿透
```

codex app-server 由 codex-app 管理生命周期，单二进制搞定一切。

## 配置文件

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
    { "id": "u1", "name": "主力" },
    { "id": "u2", "name": "测试" }
  ],
  "tokens": [
    { "token": "my-main", "userId": "u1", "label": "RN App" },
    { "token": "my-api",  "userId": "u1", "label": "API 调试" },
    { "token": "test-01", "userId": "u2", "label": "测试用" }
  ],
  "telegram": {
    "botToken": "123456:ABC..."
  },
  "wechat": {
    "enabled": true
  }
}
```

运行时数据存储在 `~/.codex-app/` 下：
- config.json — 配置
- sessions.json — session-user-project 映射
- channels.json — TG/WX 绑定关系

## 开发规范

- 运行时: Bun
- 语言: TypeScript (strict)
- 不写单测，不跑 tsc 类型检查
- 开发阶段直接 bun run，不需要 build
- 仅发布时 bun build --compile 生成二进制
- 不可变数据: 禁止 mutation
- 文件上限: 400 行，函数上限: 50 行
- 错误处理: 显式处理，不吞异常
- Import: 包内用 `@/` alias，跨包用 `@codex-app/*`
- 提交格式: `<type>: <description>` (feat/fix/refactor/docs/chore)

## 技术选型

| 层级 | 技术 |
|------|------|
| 运行时 | Bun |
| 语言 | TypeScript |
| HTTP/WS | Bun.serve (原生) |
| Codex 桥接 | codex app-server (WebSocket JSON-RPC) |
| 持久化 | JSON 文件 (~/.codex-app/) |
| TG Bot | Telegram Bot API (long polling + sendMessage/editMessageText) |
| 微信 | iLink Bot HTTP Protocol (long polling + sendmessage) |
| 部署 | bun build --compile → 单文件二进制 |

## 可复用代码索引

源项目：`/Users/Bigo/Desktop/develop/nova-infra/codexui/server/`

### @codex-app/core

| 源文件 | 行数 | 用途 | 复用级别 |
|--------|------|------|---------|
| `bridge/appServer.ts` | 335 | JSON-RPC 桥接 codex app-server，生命周期管理、通知订阅、pending request 追踪 | adapt (stdio→ws) |
| `messaging/BridgeRegistry.ts` | 295 | Bridge 实例加载/持久化/健康追踪 | copy |
| `messaging/MessagingBridge.ts` | 50 | Bridge 基础接口 (start/stop/configure/connectThread) | copy |
| `messaging/assistantReplyText.ts` | 50 | 从 thread/read 响应提取最新 assistant 消息 | copy |
| `messaging/threadCwd.ts` | 21 | 读取 thread 工作目录 | copy |
| `commandResolution.ts` | 193 | 解析 codex CLI 命令路径 (npm prefix / package dirs) | copy |
| `utils/commandInvocation.ts` | 50 | 命令调用构建器 (command + args)，shell 检测 | copy |
| `pathUtils.ts` | 50 | 路径规范化、项目名提取 | copy |
| `adminPassword.ts` | 87 | PBKDF2 密码哈希 (100k iterations) | reference |

### @codex-app/server

| 源文件 | 行数 | 用途 | 复用级别 |
|--------|------|------|---------|
| `authMiddleware.ts` | 196 | Token 认证、cookie/token 校验、localhost bypass | adapt |
| `httpServer.ts` | 696 | Bun.serve 启动、路由分发 | reference |
| `cli/index.ts` | 615 | CLI 入口、commander 参数解析 | reference |

### @codex-app/channel-telegram

| 源文件 | 行数 | 用途 | 复用级别 |
|--------|------|------|---------|
| `messaging/TelegramBridge.ts` | 968 | TG 完整实现：long polling、chat↔thread 映射、inline keyboard、model 选择、流式输出 | copy (已是 polling 模式) |

### @codex-app/channel-wechat

| 源文件 | 行数 | 用途 | 复用级别 |
|--------|------|------|---------|
| `messaging/WeChatBridge.ts` | 966 | WX iLink 完整实现：long-poll、QR 登录、消息路由 | copy |
| `messaging/iLinkClient.ts` | 404 | iLink HTTP 客户端：getUpdates/sendMessage/getConfig/QR/upload | copy |
| `messaging/wechatCdnCrypto.ts` | 187 | AES-128-ECB 解密 WeChat CDN 媒体 | copy |
| `messaging/wechatAcpStyle.ts` | 94 | Markdown→纯文本、文本分块、引用提取 | copy |
| `messaging/wechatTurnInput.ts` | 109 | iLink 消息项→codex turn/start input[] 构建 | copy |
| `messaging/wechatQrDataUrl.ts` | 17 | QR data URL 生成 | copy |

### 复用级别说明

- **copy** — 可直接复制使用，仅改 import 路径
- **adapt** — 核心逻辑可用，需要修改传输方式或接口适配
- **reference** — 参考模式和实现思路，不直接复制
