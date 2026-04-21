# 重构路线图

这份文件只回答一个问题：

**从当前 v1 形态，怎么收敛到可伸缩、可扩展、可装配的 v2。**

## 目标

- 保留同仓库模块化，不做运行时外部插件系统
- `web / wechat / telegram / cli` 进入当前规划范围
- `rn` 短期冻结，不进入当前重构主线
- 内核只保留稳定 contract、session、event、approval、codex transport
- `skill / tool / mcp / provider / storage` 全部进入 capability registry
- preset 与 CLI 负责组合，不再让 channel 反向定义系统边界

## 当前问题

结合图谱和现状，当前仓库的主问题不是“功能不够”，而是“边界过厚”：

- `WechatAdapter`、`TelegramAdapter` 是高连接 god node
- `channel-*` 同时承担入口、业务、状态、通知、渲染
- 历史账号管理能力曾和 channel 命令链路混在主运行时里
- `sessions.json`、`bindings.json`、`config.json` 缺少稳定的状态边界
- 文档曾长期混用“当前实现”“目标架构”“阶段 TODO”

## 规划原则

### 1. 先收内核，再扩能力

先把 `kernel` 与 `capability` 边界拉直，再考虑新增 channel 或功能。

### 2. Web 是能力之一，不是架构中心

`web` 可以是重要入口，但不能让内核依赖 `web` 特有实现。

### 3. Channel 只做适配，不做真相源

channel 只能处理输入输出与交互差异，不能私自拥有 session、approval、tool state 规则。

### 4. preset 取代分叉

`minimal / web-only / wechat-only / full` 都来自一套模块组合，不再复制多份 server。

## 模块保留策略

### 保留并继续演进

- `kernel/contract`
- `kernel/session`
- `kernel/events`
- `kernel/approval`
- `runtime-codex/transport`
- `capabilities/*`
- `channels/*`
- `cli assemble / doctor / print-config`

### 降级为可选模块

- `channel-wechat`
- `channel-telegram`
- `image-relay`
- `notification-adapter`
- `account-source`

### 逐步退出主线

- 历史验收文档
- 临时联调 TODO
- 旧版当前实现总览
- 以 channel 为中心的状态定义

## 分阶段推进

### Phase 0：文档和主线收口

目标：

- 只保留 `architecture/` 作为规划主线
- 用图谱识别 god node 和高耦合边界
- 删除历史阶段性文档，避免主线被旧目标污染

完成标准：

- 新入口只指向 `GRAPH_REPORT.md`、`architecture/README.md`、`roadmap.md`
- 不再保留单次验收和联调 TODO 作为长期文档

### Phase 1：抽出稳定内核

目标：

- 拆出统一 gateway contract
- 抽出 session runtime 与 approval runtime
- 把 event pipeline 从 channel 中心改成 kernel 中心

涉及模块：

- `packages/core`
- `packages/server`

完成标准：

- channel 不再直接持有 session 真相
- permission / ownership / resume fallback 在 kernel 内统一处理
- event stream 只保留一套规范

### Phase 2：建立 capability registry

目标：

- 把 `skill / tool / mcp / provider / storage` 收敛成能力注册层
- channel 不再直接决定某个能力如何接入

涉及模块：

- `packages/core`
- 新增 `packages/capabilities-*` 或同级目录

完成标准：

- capability 可以按配置开关
- channel 只消费 capability，不再嵌入 capability 规则

### Phase 3：入口插件化

目标：

- `web / wechat / telegram` 全部走统一 channel 接口
- CLI 能按 preset 装配 channel 与 capability

涉及模块：

- `packages/channel-*`
- `apps/*`
- `packages/server`

完成标准：

- 任意入口可按配置启停
- 关闭某个 channel 不影响 kernel 与其他 channel
- CLI 能输出最终装配结果与依赖检查

### Phase 4：状态层收敛

目标：

- 把配置、binding、session 边界统一
- 明确哪些是 runtime state，哪些是 persisted state

涉及模块：

- `packages/core`

完成标准：

- 不再依赖启动时快照式 token guard
- 存储驱动可替换，但 contract 不变
- channel 不再直接拼装持久化结构

## 推荐执行顺序

1. 先做 `Phase 1`
2. 再做 `Phase 2`
3. 然后做 `Phase 3`
4. 最后补 `Phase 4`

原因：

- 先拆 channel 没意义，内核没稳只会把耦合复制到更多目录
- 先稳 contract 和 event，后面的 channel/plugin 才不会再长成 god adapter

## 文档使用方式

- 讲目标边界：看 `README.md`
- 看内核职责：看 `kernel.md`
- 看模块组合：看 `modules.md`
- 看装配方式：看 `composition.md`
- 看推进顺序：看 `roadmap.md`
