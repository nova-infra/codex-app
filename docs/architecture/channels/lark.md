# channel-lark / channel-feishu（规划）

`lark / feishu` 是下一批社交软件 channel 规划项，当前只进入架构计划，不进入运行时实现、不加入 registry/preset。

## 定位

- 面向飞书 / Lark 群聊与私聊。
- 优先复用统一 channel contract、CommandRouter、Session Runtime、Approval Runtime。
- 不复制 cc-connect 的完整平台 Engine，只借鉴平台能力拆分和事件渲染策略。

## 消息样式

Feishu / Lark 返回样式按 [消息样式规范](/Users/Bigo/Desktop/develop/nova-infra/codex-app/docs/architecture/channels/message-style.md) 的 Hermes medium tier 规划：默认 `tool_progress = new`、隐藏 reasoning、优先卡片/富文本、失败文本 fallback、支持编辑时复用同一条状态消息。

## 目标能力

第一阶段只规划这些能力：

- 文本输入与普通回复
- 群聊 @ 机器人触发
- 私聊直接触发
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
3. 最后新增 `packages/channel-lark`。

## cc-connect 参考

参考但不照搬：

```text
/Users/Bigo/Desktop/develop/ai/cc-connect/platform/feishu/
/Users/Bigo/Desktop/develop/ai/cc-connect/docs/feishu.md
```

重点参考：

- 卡片 fallback 到文本
- message update / stream preview
- @ 提及解析
- 文件/图片能力拆分
- 平台错误重试边界
