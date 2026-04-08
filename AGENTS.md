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

## 运行

```bash
# 开发
bun run dev

# 编译二进制
bun run build
```

## 配置

`~/.codex-app/config.json`，运行时数据也在 `~/.codex-app/` 下。

## 复用代码须知

从 codexui 复用代码时：
1. 先读设计文档中的"可复用代码索引"确认复用级别 (copy/adapt/reference)
2. copy 级别：直接复制，只改 import 路径
3. adapt 级别：核心逻辑可用，需改接口适配
4. 复制后确保符合本项目 import 规范 (`@/` alias)
5. 复制后文件不超过 400 行，超过则拆分
