# Channel 目录

这个目录单独承载入口层说明，不再占据总架构主线。

原则：

- 主文档只讲总架构与必要模块
- channel 文档只讲各自输入输出适配
- channel 不能定义系统核心语义

## 目录

- [web](/Users/Bigo/Desktop/develop/nova-infra/codex-app/docs/architecture/channels/web.md)
- [wechat](/Users/Bigo/Desktop/develop/nova-infra/codex-app/docs/architecture/channels/wechat.md)
- [telegram](/Users/Bigo/Desktop/develop/nova-infra/codex-app/docs/architecture/channels/telegram.md)

## 统一要求

所有 channel 都只能做：

1. 接收输入
2. 转换为统一 request contract
3. 把统一 event 渲染为 channel UX

所有 channel 都不应该做：

- 自己定义 skill 语义
- 自己定义 approval 生命周期
- 自己维护一套 session 真相源
