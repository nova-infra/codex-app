# RN Client

`apps/rn-client` 是 `codex-app` 的 Expo 客户端。

参考了 `/Users/Bigo/Desktop/develop/ai/sub2api-mobile` 的组织方式，但这里先收敛为适合当前 monorepo 的最小结构：

- 使用 Expo Router 的 `app/` 路由目录
- 业务代码放在 `src/`
- 通过 workspace 直接依赖 `@codex-app/core`

## 启动

先安装依赖：

```bash
bun install
```

然后启动 Expo：

```bash
bun run dev:rn
```

或者直接在 app 目录：

```bash
bun run --cwd apps/rn-client start
```

## 环境变量

- `EXPO_PUBLIC_CODEX_SERVER_URL`
  默认值：`ws://127.0.0.1:4000/ws`

## 目录

- `app/`：Expo Router 路由入口
- `src/features/`：页面级功能
- `src/shared/`：共享配置、样式、基础组件

## 当前范围

当前已经具备 Expo 项目骨架和首页/设置页占位，但还没有接入真实的 WebSocket 会话、鉴权和消息流。
