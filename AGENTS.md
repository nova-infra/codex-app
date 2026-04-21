# Codex App Workspace

统一的 Codex 服务层，为 Web / Telegram / 微信提供 AI 编程能力。

## 仓库定位

- `README.md` 只作为索引入口，不承载详细说明
- 当前实现仍然是 `v1`
- 后续规划、模块边界和推进顺序统一以 `docs/architecture/` 为准
- 回答架构或代码结构问题时，优先结合 `graphify-out/GRAPH_REPORT.md` 与 `docs/architecture/`

## 文档路由

| 需要了解 | 读这个 |
|---------|--------|
| 图谱总览 | `graphify-out/GRAPH_REPORT.md` |
| 目标架构 | `docs/architecture/README.md` |
| CLI 架构 | `docs/architecture/cli.md` |
| 重构路线图 | `docs/architecture/roadmap.md` |
| 版本/发布工作流 | `docs/workflows/versioning-and-release.md` |

## 文档语言

- 默认使用中文编写文档、说明和规划内容
- 只有在需要对外发布、对接英文资料或用户明确要求时，才补充英文版本

## 架构概览

```
Web ──ws──▸ codex-app server ──ws──▸ codex app-server (单实例)
TG Bot ──long polling──▸ server
微信 ──iLink long polling──▸ server
```

无需公网 IP，无需穿透。

## 当前主线

- 稳定内核
- capability registry
- channel plugin
- preset 驱动装配

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
