# codex-app 与 cc-connect Codex 主线差距记录

本文记录 2026-05-09 对 `/Users/Bigo/Desktop/develop/nova-infra/codex-app` 与 `/Users/Bigo/Desktop/develop/ai/cc-connect` 的静态对比。目标不是照搬 cc-connect，而是借鉴其 Codex 主线能力，补齐 codex-app 的项目、Provider、会话、Channel 与管理面缺口。

> 注：当前仓库未找到 `graphify-out/GRAPH_REPORT.md`，本记录基于 `docs/architecture/`、`packages/*` 源码和 cc-connect 的 `config/`、`core/`、`agent/codex/`、`platform/`、`docs/` 目录整理。

## 一句话结论

- `codex-app` 当前是轻量的 **Codex app-server 网关 + TG/微信社交入口雏形**；Feishu / Lark 只进入规划，暂不实现。
- `cc-connect` 的 Codex 主线已经是 **多项目、多 Provider、多平台、管理 API、Bridge、命令体系、守护进程、定时任务的一体化运行时**。
- codex-app 应优先补齐 Codex 主线的运行时真相源，不应短期追 cc-connect 的多 Agent 和全平台矩阵。

## 当前 codex-app 能力

已具备：

- Bun/TypeScript workspace。
- `packages/core` 提供 config、session、binding、event pipeline、contract router、registry 雏形。
- `packages/server` 启动单个 `codex app-server`，提供 `/health`、`/version`、`/ws`。
- `packages/channel-telegram` 与 `packages/channel-wechat` 提供 long polling channel。
- WebSocket 入口支持 token 鉴权和基础 JSON-RPC 代理。
- TG/微信支持基础绑定、会话、项目目录、模型、推理、审批、状态展示。
- CLI 已有 `doctor/init/preset/channel/capability/config/assemble/runtime/request` 雏形。

主要限制：

- Provider registry 仍偏元数据，没有真实 Provider/Profile 管理。
- 配置是单实例思路，缺少 cc-connect 那种 `[[projects]]` 真相源。
- `CodexClient` 是全局单 app-server 连接，难表达 per-project `CODEX_HOME`、Provider、mode、env。
- 命令逻辑仍分散在 channel 内。
- Management API、Bridge、daemon、cron、hooks、attachment send、rate limit 还没有形成。
- Web channel 暂时不进主线；已有 `/ws` 只按内部调试/兼容入口看待。

## cc-connect Codex 主线可借鉴能力

重点参考文件：

```text
/Users/Bigo/Desktop/develop/ai/cc-connect/config/config.go
/Users/Bigo/Desktop/develop/ai/cc-connect/core/interfaces.go
/Users/Bigo/Desktop/develop/ai/cc-connect/core/engine.go
/Users/Bigo/Desktop/develop/ai/cc-connect/core/command.go
/Users/Bigo/Desktop/develop/ai/cc-connect/core/management.go
/Users/Bigo/Desktop/develop/ai/cc-connect/core/bridge.go
/Users/Bigo/Desktop/develop/ai/cc-connect/agent/codex/codex.go
/Users/Bigo/Desktop/develop/ai/cc-connect/agent/codex/appserver_session.go
/Users/Bigo/Desktop/develop/ai/cc-connect/agent/codex/provider_config.go
```

值得借鉴：

1. **Project 配置模型**
   - `[[projects]]` 绑定项目名、work_dir/base_dir、agent、platforms、权限、display、auto-compress、reset-on-idle。
   - 支持一个进程管理多个项目。

2. **Provider/Profile 管理**
   - 全局 `[[providers]]` + project `provider_refs`。
   - Provider 可限制 `agent_types`，可配置 base_url、model、models、env、Codex 专属 wire_api/http_headers。
   - 支持运行时切换 Provider。

3. **Codex runtime 隔离**
   - 支持 `codex_home`。
   - 可为 provider 写 `$CODEX_HOME/config.toml` 的 `[model_providers.<name>]`。
   - 可写 `$CODEX_HOME/auth.json`，避免污染用户主 `~/.codex`。

4. **命令体系**
   - `/new`、`/list`、`/switch`、`/current`、`/history`、`/usage`、`/provider`、`/model`、`/dir`、`/show`、`/allow`、`/reasoning`、`/mode`、`/stop`、`/cron`、`/workspace`。
   - 命令由 core/engine 管理，平台只负责输入输出。

5. **外部接入面**
   - Management API：项目、Provider、session、cron、settings、reload/restart。
   - Bridge：外部适配器通过 WebSocket/REST 接入，不必改 Go 代码。

## 功能差距矩阵

| 能力 | codex-app 当前 | cc-connect Codex 主线 | 建议优先级 |
|---|---|---|---|
| 多项目 | `defaultCwd` / binding cwd | `[[projects]]` 完整模型 | P0 |
| Provider 管理 | registry 占位 | 全局 Provider + project refs + 运行时切换 | P0 |
| Codex Home 隔离 | 依赖环境/单实例 | per-project `codex_home` | P0 |
| Runtime 参数 | 全局 app-server | project/session model/reasoning/mode/provider/env | P0 |
| 会话命令 | `/new` `/session` | `/new/list/switch/current/history/usage/stop` | P1 |
| 工作目录 | `/project <path>` | `/dir` 历史、序号、`-` | P1 |
| 权限模式 | 启动固定 | `/mode` 运行时切换 | P1 |
| Provider 命令 | 无 | `/provider list/switch/add/remove` | P1 |
| 使用量 | context policy 雏形 | usage/rate limits/context footer | P1 |
| Management API | `/health` `/version` | `/api/v1/*` | P2 |
| Bridge | 私有 `/ws` JSON-RPC | 通用 adapter 协议 | P2 |
| Web UI | 暂不做 | 内嵌管理后台 | 暂缓 |
| Cron | 无 | 聊天命令 + CLI + Agent prompt 注入 | P3 |
| 附件回传 | 微信图片 relay 局部 | `cc-connect send --image/--file` | P3 |
| STT/TTS | 无 | speech / tts | P4 |
| 多 Agent | Codex only | Claude/Codex/Gemini/... | 暂不追 |
| 全平台 | TG/微信，Feishu/Lark 规划中 | 11 个平台 | 暂不追 |

## Channel 差距与补齐方向

### codex-app 现有 Channel 边界

当前文档对 channel 的要求是正确的：

- channel 只负责输入适配、输出渲染、channel UX。
- 不定义 skill/tool/provider 语义。
- 不维护 session 真相源。

但源码上仍有几个问题：

- Telegram 与 WeChat 各自实现 slash command，重复且容易漂移。
- channel 内维护了 chatId/threadId、model、reasoning、approval pending 等多份状态。
- `/ws` 仍在 server 内，但短期只作为内部调试/兼容入口，不再规划为 Web channel。
- Channel 能力没有显式声明，例如是否支持 image/file/audio/card/update/typing/reconstruct_reply。

### cc-connect Channel/Platform 模型

cc-connect 的平台模型值得借鉴，但要改成 codex-app 的 TypeScript 形态：

- 基础接口：`Name / Start / Reply / Send / Stop`。
- 可选能力接口：
  - `TypingIndicator`
  - `ImageSender`
  - `FileSender`
  - `MessageUpdater`
  - `CardSender`
  - `InlineButtonSender`
  - `ReplyContextReconstructor`
  - `ProgressStyleProvider`
- Bridge adapter 通过能力声明决定能否发送 text/image/file/audio/card/update。

codex-app 应把这些抽象为 Channel capability，而不是把每个平台能力硬编码到 kernel。

### Hermes-style 消息样式补齐

WeChat / Telegram / Feishu-Lark 的用户可见返回样式统一参考 `/Users/Bigo/Desktop/develop/ai/hermes-agent` Gateway：TG 走 high tier，WeChat 走 low tier，Feishu/Lark 走 medium tier。具体约束见 `docs/architecture/channels/message-style.md`。

### 建议的 Channel 接口

```ts
export type ChannelCapability =
  | 'text'
  | 'stream'
  | 'typing'
  | 'message-update'
  | 'inline-actions'
  | 'card'
  | 'image-in'
  | 'image-out'
  | 'file-in'
  | 'file-out'
  | 'audio-in'
  | 'audio-out'
  | 'reconstruct-reply'

export type ChannelRuntime = {
  readonly key: string
  readonly capabilities: readonly ChannelCapability[]
  start(deps: ChannelDeps): Promise<void>
  stop(): Promise<void>
}
```

Channel 输入统一成：

```ts
export type ChannelInput = {
  readonly channel: string
  readonly externalId: string
  readonly userId?: string
  readonly text?: string
  readonly images?: readonly ChannelImage[]
  readonly files?: readonly ChannelFile[]
  readonly audio?: ChannelAudio
  readonly action?: ChannelAction
  readonly replyContext: unknown
}
```

Kernel 输出统一成：

```ts
export type ChannelOutput =
  | { kind: 'text'; text: string }
  | { kind: 'progress'; text: string; state: 'running' | 'done' | 'error' }
  | { kind: 'approval'; requestId: number; title: string; body: string; options: readonly ApprovalOption[] }
  | { kind: 'image'; filePath?: string; data?: Uint8Array; mimeType?: string }
  | { kind: 'file'; filePath?: string; data?: Uint8Array; mimeType?: string; filename: string }
  | { kind: 'typing'; active: boolean }
```

### Channel 优先级

P0：先抽共用命令路由，减少 TG/微信漂移。

```text
packages/core/src/commands/commandRouter.ts
packages/core/src/commands/builtins/*
```

P1：补 Channel capability 声明。

```text
packages/core/src/channel/channelTypes.ts
packages/core/src/channel/channelRuntime.ts
packages/core/src/registry/channelRegistry.ts
```

P2：补 Bridge channel，让外部平台不再需要内置包。

```text
packages/channel-bridge/src/server.ts
packages/channel-bridge/src/protocol.ts
```

P3：再考虑 cc-connect 里其他平台是否需要接入。优先通过 Bridge，而不是为每个平台新增 package。

### Feishu / Lark 规划项

Feishu / Lark 是下一批社交 channel 规划，但先不实现代码、不加入 registry/preset。原因：

- 先让 TG / 微信的命令、session、approval 语义回收到 core。
- Feishu / Lark 有卡片、消息编辑、@ 提及、文件/图片等更复杂能力，适合在 `ChannelCapability` 稳定后接入。
- cc-connect 的 `platform/feishu` 可作为能力拆分参考，但不复制 Go Engine。

规划顺序：

1. 完成 core `CommandRouter`。
2. 完成 `ChannelInput / ChannelOutput / ChannelCapability`。
3. 新增 `packages/channel-lark`，同时支持 Feishu / Lark 命名。
4. 再评估 WeCom、Slack、Discord、QQ、LINE 等候选平台。

## 推荐落地顺序

### Phase 1：Project + Provider 真相源

目标：不污染 `~/.codex`，支持项目级 Provider/Codex Home。

建议新增：

```text
packages/core/src/project/projectTypes.ts
packages/core/src/project/projectStore.ts
packages/core/src/provider/providerTypes.ts
packages/core/src/provider/providerStore.ts
packages/core/src/provider/providerProfileService.ts
packages/core/src/provider/codexProviderWriter.ts
```

完成标准：

- `codex-app provider add --project <name> ...`
- `codex-app provider switch --project <name> <provider>`
- project-local `CODEX_HOME` 生效。
- 不修改用户主 `~/.codex`。

### Phase 2：CommandRouter 收敛

目标：TG/微信等社交入口共享同一套命令语义。

先补：

```text
/list
/switch <id>
/current
/usage
/mode
/dir /cd
/provider list/switch
/stop
```

### Phase 3：Channel capability 化

目标：channel 只声明能力和渲染，不持有系统真相。

完成标准：

- TG/微信的命令、approval、session 逻辑由 core 处理。
- channel 只将 `ChannelInput` 交给 kernel，并渲染 `ChannelOutput`。
- `/ws` 不作为主线 channel 推进，仅保留内部调试/兼容用途。

### Phase 4：Management API

目标：让脚本、其他 agent 或后续管理工具能管理 codex-app；不以 Web UI 为短期目标。

先补：

```text
GET  /api/v1/status
GET  /api/v1/projects
GET  /api/v1/sessions?project=
GET  /api/v1/providers
PATCH /api/v1/projects/:name
POST /api/v1/reload
```

### Phase 5：Bridge

目标：把未来平台扩展放到外部 adapter，不再持续膨胀 server/channel 内置包。

先支持：

```text
register
message
event
approval
session list/start/switch
```

## 暂缓项

暂缓：

- 多 Agent。
- cc-connect 的全平台内置适配。
- Web 管理后台。
- Cron。
- STT/TTS。
- run_as_user。

这些都应该在 Project/Provider/Channel/Management API 稳定后再做。
