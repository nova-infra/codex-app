# Codex App 开源产品介绍图文案

这份文件不是架构设计文档，而是给 `GPT-IMAGE-2`、设计师或品牌同学使用的**整体产品介绍图生成稿**。

目标：

- 一张图讲清 `codex-app` 是什么
- 一张图讲清当前架构能力和产品边界
- 一张图讲清它为什么适合做开源产品

---

## 1. 产品一句话

`codex-app` 是一个面向开源场景的 **Codex 服务层框架**，用统一内核连接 `Web / Telegram / WeChat` 等多种入口，把会话、事件、审批、能力注册和运行时装配收敛成一套可扩展体系。

更短版本：

**一个稳定内核 + 多入口插件 + CLI 装配层的开源 Codex runtime framework**

---

## 2. 产品定位

适合这样介绍：

- 面向开源开发者的 Codex 服务层框架
- 可插拔、多入口、可装配的 AI coding runtime
- 统一 Web、Telegram、WeChat 的会话与事件内核
- 不做“大一统中台”，而是做“稳定内核 + 薄插件”

不建议这样介绍：

- 不要说成聊天机器人皮肤
- 不要说成单一 Telegram Bot 项目
- 不要强调私有化账号管理
- 不要把重点放在旧版 RN 或历史包袱上

---

## 3. 新框架核心特点

### 3.1 稳定内核

- `threadId` 是唯一会话真相源
- `new / compact / switch / approval` 全部回到内核处理
- `SessionControlService` 统一维护会话控制
- `SessionPolicyEngine` 统一维护自动策略
- `EventPipeline` 统一归一化 runtime 事件
- `ContractRouter` 统一处理对外 contract

适合图上的关键词：

- Single Source of Truth
- Stable Session Kernel
- Unified Event Pipeline
- Contract First

### 3.2 Channel Plugin 化

- `web / telegram / wechat` 都是 channel plugin
- channel 只负责输入输出适配和体验优化
- channel 不再保存协议真相和会话真相
- 新入口可以继续按同样 contract 扩展

适合图上的关键词：

- Channel Plugins
- Thin Adapters
- UX Optimization Only
- Same Kernel, Different Surfaces

### 3.3 Capability Registry

- 技能、工具、MCP、provider profile 都进入统一 registry
- storage adapter、image relay、notification adapter 都变成显式能力模块
- channel 只能声明依赖，不决定能力接法
- 不同入口共享同一套能力语义

适合图上的关键词：

- Capability Registry
- Skills
- Tools
- MCP
- Provider Profiles
- Storage Adapters

### 3.4 CLI 装配层

- 提供 `codex-app` CLI
- 支持 `doctor / init / preset / channel / capability / config / assemble / runtime / request`
- 支持 preset 驱动装配
- 支持 `minimal / web-only / wechat-only / full`
- 适合本地开发、部署前检查、配置管理、运行启动

适合图上的关键词：

- Composable CLI
- Preset Driven
- Runtime Assembly
- Doctor & Config

### 3.5 开源友好

- 输出默认脱敏，避免 token 直接暴露
- release 走 Go 构建自动化
- PR 有 Go smoke 校验
- release PR 自动生成
- 清理二进制产物和无关测试文件

适合图上的关键词：

- Open Source Ready
- Redacted by Default
- Automated Changelog
- Clean Repository

---

## 4. 推荐的信息结构

如果做一张整体产品介绍图，建议分成 6 个信息块：

1. 顶部标题区
2. 一句话定位区
3. 中间主架构图区
4. 右侧核心能力列表
5. 底部 CLI / preset / automation 区
6. 底部开源特性区

---

## 5. 推荐画面文案

### 主标题

可选版本 1：

**Codex App**

### 副标题

可选版本 1：

**Open-source Codex Runtime Framework**

可选版本 2：

**Stable Kernel for Web, Telegram and WeChat**

可选版本 3：

**One Session Kernel, Multiple Channel Plugins**

### 核心标语

可选版本：

- Stable Kernel, Thin Plugins
- Contract First, Channel Last
- One Runtime, Multiple Surfaces
- Session Truth Lives in the Kernel

---

## 6. 推荐主图结构

中心放一个四层结构：

### 第一层：Channels

- Web
- Telegram
- WeChat
- Future Plugins

### 第二层：Gateway Kernel

- Session Control
- Policy Engine
- Event Pipeline
- Contract Router

### 第三层：Capability Registry

- Skills
- Tools
- MCP
- Provider Profiles
- Storage Adapter
- Image Relay
- Notification Adapter

### 第四层：Runtime

- Codex Transport
- codex app-server

底部单独拉一条：

- `codex-app CLI`
- doctor
- preset
- assemble
- runtime

---

## 7. 建议强调的功能标签

适合放在图上的短标签：

- WebSocket Gateway
- Session Control
- Approval Flow
- Stream Events
- Capability Registry
- Plugin Channels
- Preset Assembly
- CLI Driven
- Open Source Ready
- Redacted Output
- Automated Changelog

---

## 8. 适合图像模型的风格要求

建议风格：

- 开源基础设施产品海报
- 技术产品发布页主视觉
- 信息图 + 架构图混合
- 清晰、现代、模块化、轻工业感
- 不要做成卡通 bot
- 不要做成社交 App 宣传图
- 不要做成单一聊天界面截图

视觉关键词：

- clean system diagram
- modular architecture blocks
- open-source developer tooling
- terminal + runtime + plugin visual language
- precise typography
- grid-based layout

色彩建议：

- 主色偏深蓝、青绿、石墨灰
- 点缀色可用亮青、橙色或浅黄
- 背景不要纯黑
- 不要紫色主导

---

## 9. 适合 GPT-IMAGE-2 的直接 Prompt

下面这段可以直接作为第一版图片生成提示词：

```text
Create a polished open-source product introduction poster for “Codex App”.

The product is an open-source Codex runtime framework with a stable kernel, channel plugins, a capability registry, and a composable CLI.

Main message:
- Stable Kernel, Thin Plugins
- One Session Kernel, Multiple Channel Plugins
- Open-source Codex Runtime Framework

Visual structure:
- top title area with “Codex App”
- subtitle: “Open-source Codex Runtime Framework”
- central layered architecture diagram
- layer 1: Web, Telegram, WeChat, Future Plugins
- layer 2: Session Control, Policy Engine, Event Pipeline, Contract Router
- layer 3: Skills, Tools, MCP, Provider Profiles, Storage Adapter, Image Relay, Notification Adapter
- layer 4: Codex Transport, codex app-server
- bottom area for CLI: doctor, preset, assemble, runtime
- side panel showing key features: session truth in kernel, plugin channels, capability registry, redacted output, automated changelog

Design style:
- premium developer tooling poster
- clean technical infographic
- modern open-source infrastructure product
- modular, grid-based, precise typography
- dark graphite background with cyan and warm accent colors
- minimal but bold
- no cartoon bots
- no chat screenshot style
- no mobile app marketing vibe

Need the final image to feel like a launch graphic for a serious open-source AI infrastructure framework.
```

---

## 10. 中文版 Prompt

如果你要中文输入图像模型，可以用这版：

```text
请生成一张“Codex App”的开源产品介绍海报。

它是一个面向开发者的开源 Codex runtime framework，核心特点是：
- 稳定内核
- 多 channel 插件
- capability registry
- CLI 装配层
- 会话真相统一在内核
- 支持 Web / Telegram / WeChat
- 默认脱敏输出
- changelog 自动化

画面结构要求：
- 顶部标题：Codex App
- 副标题：Open-source Codex Runtime Framework
- 中间是一张四层架构图
- 第一层是 Web、Telegram、WeChat、Future Plugins
- 第二层是 Session Control、Policy Engine、Event Pipeline、Contract Router
- 第三层是 Skills、Tools、MCP、Provider Profiles、Storage Adapter、Image Relay、Notification Adapter
- 第四层是 Codex Transport 和 codex app-server
- 底部单独展示 codex-app CLI，包含 doctor、preset、assemble、runtime
- 旁边展示卖点标签：Stable Kernel、Thin Plugins、Contract First、Open Source Ready、Automated Changelog、Redacted Output

风格要求：
- 像严肃的开源基础设施产品发布海报
- 信息图 + 架构图结合
- 高级、清晰、模块化、现代
- 深石墨灰背景，青绿色高亮，少量暖色点缀
- 不要卡通，不要聊天截图风，不要社交产品风
```

---

## 11. 出图时不要遗漏的点

- 这是开源框架，不是单一 bot
- Web / Telegram / WeChat 是插件入口，不是三套独立系统
- 内核比 channel 更重要
- CLI 是产品的一部分，不只是脚本
- 要体现 capability registry
- 要体现“统一 session / event / approval contract”

---

## 12. 一句话交付说明

如果把这份文案发给图像模型或设计师，可以这样补一句：

**请基于这份文案生成一张整体的开源产品介绍图，重点突出“稳定内核、能力注册、可插拔入口、CLI 装配、开源友好”。**
