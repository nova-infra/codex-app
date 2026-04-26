# Codex 事件清单

本文按 codex app-server JSON-RPC 事件整理，用于统一 Telegram / WeChat 的状态展示。

## 已观测通知事件

- `turn/started`：一次 turn 开始。适合初始化「处理中」状态；当前仅记录日志。
- `item/started`：一个 item 开始。核心状态入口，根据 `params.item.type` 展示一行状态。
- `item/completed`：一个 item 完成。当前主要用于图片结果转发；普通工具完成不单独展示。
- `item/agentMessage/delta`：助手正文增量。TG 目前不直接流式展示，避免「正文先出、工具后出」乱序；最终在 `turn/completed` 统一发送。
- `item/reasoning/summaryTextDelta`：reasoning 摘要增量。只有上游真的提供 delta 时才显示；多数情况下 `reasoning.summary/content` 为空。
- `item/commandExecution/outputDelta`：命令输出增量。已在日志观测到；可选展示为 `📟 <输出片段>`，默认不建议刷屏。
- `item/commandExecution/terminalInteraction`：命令交互事件。可展示为 `⌨️ 等待终端输入`。
- `turn/completed`：turn 完成。读取 thread 最新 assistant，并发送最终答案。
- `thread/tokenUsage/updated`：上下文使用率更新。超过阈值时提示压缩/新会话。
- `thread/status/changed`：线程状态变化。当前不展示。
- `account/rateLimits/updated`：账号限额变化。当前不展示。
- `error`：请求错误。展示错误消息并清理 typing/progress。
- `*Approval`：审批请求。展示确认/拒绝按钮或回复选项。

## `item/started` item.type 映射

- `reasoning` → `🧠 Thinking`；只有真实 summary delta 才显示内容。
- `commandExecution` → `⚙️ <command>`
- `fileChange` → `✏️ 编辑 <filename>`
- `webSearch` → `🔎 <query>`
- `mcpToolCall` → `🧰 <server>.<tool>`
- `dynamicToolCall` → `🛠️ <tool>`
- `plan` → `📌 制定计划`
- `imageView` → `🖼️ 查看图片`
- `imageGeneration` → `🎨 生成图片`
- `memory` / `memoryRead` / `memoryWrite` → `🧠/💾 <key/query>`
- `hook` / `hookCall` → `🪝 <hook>`
- `agentMessage` / `userMessage` → 不展示状态，避免噪音。

## 展示策略

- Telegram：按微信方式处理，状态只保留一行；最终答案在状态之后发送，避免「文字 → 工具」乱序。
- WeChat：状态一行去重限频；最终答案由 `turn/completed` 发送。
- 不再强制正文输出人工 `🧠 思路`，因为这不是 Codex 原生 thinking。

## 客户端主动调用

- `initialize` / `initialized`：连接握手。
- `thread/start`、`thread/resume`、`thread/read`、`thread/list`、`thread/archive`、`thread/compact/start`：会话管理。
- `turn/start`、`turn/interrupt`、`turn/steer`：turn 控制。
- `model/list`：模型列表。
- `approval/respond`：审批响应。
