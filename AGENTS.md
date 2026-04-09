# Codex App Workspace

统一的 Codex 服务层，为 RN App / Telegram / 微信提供 AI 编程能力。

## 文档路由

| 需要了解 | 读这个 |
|---------|--------|
| 完整设计文档 | `docs/specs/2026-04-08-codex-app-design.md` |
| 版本/发布工作流 | `docs/workflows/versioning-and-release.md` |

## 图谱约定

- `Graphify` 在本仓库内统一称为 `图谱`
- 需要做代码结构理解、跨文件关系查询、仓库摘要时，优先先跑 `graphify`
- 生成结果默认看 `graphify-out/GRAPH_REPORT.md` 和 `graphify-out/graph.json`
- 后续在对话里说“查图谱”“更新图谱”“看图谱”，都指 `Graphify`

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
| `@codex-app/channel-telegram` | `packages/channel-telegram/` | TG Bot：long polling、inline keyboard、HTML 格式化 |
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

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"` to keep the graph current
