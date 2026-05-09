# 必要模块组合

主文档只保留 **必要模块组合**，不把 Telegram / WeChat 等入口细节放在这里。

## 模块分组

### A. 必选模块

这些模块不应该被插件化掉：

- `runtime-codex/transport`
- `kernel/contract`
- `kernel/session`
- `kernel/events`
- `kernel/approval`

没有这组模块，系统就不再是 “Codex-compatible gateway”。

### B. 能力模块

这些模块应该可开关：

- `skills`
- `tools`
- `mcp`
- `provider-profiles`
- `storage-adapter`
- `image-relay`
- `notification-adapter`

### C. 入口模块

这些模块都应该视为对等 plugin：

- `channel-wechat`
- `channel-telegram`
- `channel-*`

暂时不把 `channel-web` 放入入口模块主线；已有 WebSocket 代理只作为内部调试/兼容入口。

下一批规划入口是 `channel-lark` / `channel-feishu`，但当前只进入文档计划，不进入 registry/preset。

## 推荐 preset

### `minimal`

```text
kernel + codex transport
```

用途：

- 内核调试
- contract 测试
- runtime 联调

### `telegram-only`

```text
kernel
+ codex transport
+ skills
+ tools
+ storage
+ channel-telegram
```

用于 Telegram 单入口部署。

### `wechat-only`

```text
kernel
+ codex transport
+ skills
+ tools
+ storage
+ image-relay
+ channel-wechat
```

### `social`

```text
kernel
+ codex transport
+ social capabilities
+ channel-wechat
+ channel-telegram
+ channel-lark (planned)
```

这是当前默认主路径，聚焦社交软件入口。

## 模块组合矩阵

| 模块 | minimal | telegram-only | wechat-only | social |
|---|---|---:|---:|---:|
| kernel | yes | yes | yes | yes |
| codex transport | yes | yes | yes | yes |
| skills | no | yes | yes | yes |
| tools | no | yes | yes | yes |
| mcp | no | optional | optional | optional |
| storage adapter | optional | yes | yes | yes |
| image relay | no | no | yes | yes |
| channel-wechat | no | no | yes | yes |
| channel-telegram | no | yes | no | yes |

## 关键约束

### 1. 入口组合不能反向污染内核

不能因为启用了 `channel-wechat`，就把数字 approval、文本裁剪、chatId 语义塞回 kernel。

### 2. 能力组合不能改变 contract

skill / tool / MCP 再怎么变化，也只能扩展 capability registry，不能把 kernel contract 撕开。

### 3. preset 是配置，不是分叉代码库

`telegram-only`、`wechat-only`、`social` 都应该来自同一套仓库和模块边界，不是维护多套 server。
