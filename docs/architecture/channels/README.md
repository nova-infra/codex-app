# Channel 目录

这个目录单独承载入口层说明，不再占据总架构主线。

原则：

- 主文档只讲总架构与必要模块
- channel 文档只讲各自输入输出适配
- channel 不能定义系统核心语义

## 目录

- [wechat](/Users/Bigo/Desktop/develop/nova-infra/codex-app/docs/architecture/channels/wechat.md)
- [telegram](/Users/Bigo/Desktop/develop/nova-infra/codex-app/docs/architecture/channels/telegram.md)
- [消息样式规范](/Users/Bigo/Desktop/develop/nova-infra/codex-app/docs/architecture/channels/message-style.md)
- [Hermes 返回逻辑深化方案](/Users/Bigo/Desktop/develop/nova-infra/codex-app/docs/architecture/channels/hermes-return-logic-plan.html)
- [lark / feishu（规划）](/Users/Bigo/Desktop/develop/nova-infra/codex-app/docs/architecture/channels/lark.md)

## 当前主线

短期不做 Web channel。当前 channel 主线只聚焦社交软件：

- Telegram
- 微信
- Feishu / Lark（下一批规划，暂不实现）
- 后续其他 IM / 社交平台

WebSocket 代理可以作为内部调试/兼容入口存在，但不作为规划里的 channel 主线。

## 统一要求

所有 channel 的返回消息样式统一参考 [消息样式规范](/Users/Bigo/Desktop/develop/nova-infra/codex-app/docs/architecture/channels/message-style.md)，以 `/Users/Bigo/Desktop/develop/ai/hermes-agent` 的 Gateway 展示策略为基准。

所有 channel 都只能做：

1. 接收输入
2. 转换为统一 request contract
3. 把统一 event 渲染为 channel UX

所有 channel 都不应该做：

- 自己定义 skill 语义
- 自己定义 approval 生命周期
- 自己维护一套 session 真相源


## 后续 channel 计划

当前实现主线仍是 Telegram / 微信。新增平台按下面顺序规划，先写 contract 与能力声明，再实现具体包：

1. `channel-lark` / `channel-feishu`：下一批优先规划项。
2. `channel-wecom`：企业微信，可复用微信/飞书的文本、图片、文件、审批经验。
3. `channel-slack` / `channel-discord`：适合团队群聊，但先通过 Bridge 验证外部 adapter 路线。
4. `channel-qq` / `channel-line`：暂列候选，不进入近期主线。

约束：新增 channel 前，必须先完成 core CommandRouter 与 ChannelCapability，避免继续复制 TG / 微信 adapter 里的命令和状态逻辑。
