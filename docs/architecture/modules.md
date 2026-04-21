# 必要模块组合

主文档只保留 **必要模块组合**，不把 Web / WeChat / Telegram 入口细节放在这里。

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

- `channel-web`
- `channel-wechat`
- `channel-telegram`
- `channel-*`

## 推荐 preset

### `minimal`

```text
kernel + codex transport
```

用途：

- 内核调试
- contract 测试
- runtime 联调

### `web-only`

```text
kernel
+ codex transport
+ skills
+ tools
+ mcp
+ storage
+ channel-web
```

这是默认主路径。

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

### `full`

```text
kernel
+ codex transport
+ all capabilities
+ channel-web
+ channel-wechat
+ channel-telegram
```

## 模块组合矩阵

| 模块 | minimal | web-only | wechat-only | full |
|---|---|---:|---:|---:|
| kernel | yes | yes | yes | yes |
| codex transport | yes | yes | yes | yes |
| skills | no | yes | yes | yes |
| tools | no | yes | yes | yes |
| mcp | no | yes | optional | yes |
| storage adapter | optional | yes | yes | yes |
| image relay | no | optional | yes | yes |
| channel-web | no | yes | no | yes |
| channel-wechat | no | no | yes | yes |
| channel-telegram | no | no | no | yes |

## 关键约束

### 1. 入口组合不能反向污染内核

不能因为启用了 `channel-wechat`，就把数字 approval、文本裁剪、chatId 语义塞回 kernel。

### 2. 能力组合不能改变 contract

skill / tool / MCP 再怎么变化，也只能扩展 capability registry，不能把 kernel contract 撕开。

### 3. preset 是配置，不是分叉代码库

`web-only`、`wechat-only`、`full` 都应该来自同一套仓库和模块边界，不是维护三套 server。
