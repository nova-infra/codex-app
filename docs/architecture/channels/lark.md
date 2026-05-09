# channel-lark / channel-feishu

`lark / feishu` 已进入 Go 运行时的可测试真实链路：支持 tenant access token、主动发送文本消息、WebSocket 长连接收消息、HTTP 事件订阅 challenge、收到文本消息后的原生 message reply，以及普通文本转发到真实 `codex exec` 回复。更完整的卡片、流式编辑、文件/图片能力仍按本文规划推进。

## 运行时环境变量

| 变量 | 说明 |
| --- | --- |
| `LARK_APP_ID` | Lark / 飞书应用 ID |
| `LARK_APP_SECRET` | Lark / 飞书应用密钥，只从运行环境注入，不写入仓库 |
| `LARK_API_BASE` | API 域名；国际版使用 `https://open.larksuite.com` |
| `LARK_WS_DISABLED` | 设为 `true` 时禁用 WebSocket 长连接 |
| `LARK_LOADING_REACTION_EMOJI` | 可选，处理中状态使用的 Lark 系统 reaction；默认复刻 cc-connect 的 `OnIt`，设为 `none` 关闭 |
| `CODEX_APP_DISABLE_CODEX` | 设为 `true` 时普通消息回退到本地 kernel 占位/命令 |
| `CODEX_EXECUTABLE` | 可选，覆盖 `codex` 可执行文件路径 |
| `CODEX_EXEC_MODEL` | 可选，给 Lark 消息调用 `codex exec -m`，用于低成本模型 |
| `CODEX_EXEC_WORKDIR` | 可选，指定 `codex exec` 工作目录 |
| `CODEX_EXEC_TIMEOUT_SECONDS` | 可选，单条 Lark 消息等待 Codex 的超时时间 |

普通文本默认走 `codex exec --ephemeral --skip-git-repo-check -s read-only -o <file>`，读取最终回答文件，避免把 CLI 进度日志误发给用户。处理期间会先给用户原消息添加 Lark 系统 reaction `OnIt`，完成后移除；slash command 仍由本地 kernel 处理。

## 定位

- 面向飞书 / Lark 群聊与私聊。
- 优先复用统一 channel contract、CommandRouter、Session Runtime、Approval Runtime。
- 不复制外部项目实现；只在本仓库内维护 Lark channel 边界。

## 消息样式

Feishu / Lark 返回样式按 [消息样式规范](/Users/Bigo/Desktop/develop/nova-infra/codex-app/docs/architecture/channels/message-style.md) 的 Hermes medium tier 规划：默认 `tool_progress = new`、隐藏 reasoning、优先卡片/富文本、失败文本 fallback、支持编辑时复用同一条状态消息。

## 目标能力

第一阶段已落地/规划这些能力：

- 文本输入与普通回复（已落地最小链路）
- 群聊 @ 机器人触发（默认走 Lark WebSocket 长连接）
- 私聊直接触发（默认走 Lark WebSocket 长连接）
- 统一 slash command
- approval 卡片或按钮
- 进度消息 / 流式编辑
- 图片输入 / 图片回传（可选）
- 文件输入 / 文件回传（可选）

后续再评估：

- 多维表格 / 文档类扩展
- 语音 STT / TTS
- 富卡片导航
- 外部 Bridge adapter 模式

## 不负责

- 不拥有 session 真相源
- 不定义 Provider / model / mode 规则
- 不内置项目管理状态
- 不把飞书卡片结构泄漏进 kernel

## 推荐实施顺序

1. 先完成 core `CommandRouter`，让 TG / 微信命令语义收敛。
2. 再完成 `ChannelInput / ChannelOutput / ChannelCapability`。
3. 已新增 `internal/channel/lark` 最小运行时，后续继续补卡片、流式编辑和媒体能力。
