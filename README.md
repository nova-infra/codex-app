# Codex App

统一的 Codex 服务层仓库。

> 说明：本仓库的默认开发入口已切到 Go 版 `cmd/codex-app`，用于实现 `doctor / serve --dry-run / config` 等预检入口。
> Bun/TS CLI 与 `packages/*` 保留为 Legacy 兼容运行入口。

![Codex App Overview (EN)](docs/project/assets/overview.png)
## 产品总览

## 入口

| 需要了解 | 读这个 |
|---------|--------|
| 项目状态 | `docs/project/status.md` |
| 快速启动 | `docs/project/getting-started.md` |
| 图谱总览 | `graphify-out/GRAPH_REPORT.md` |
| 目标架构 | `docs/architecture/README.md` |
| CLI 架构 | `docs/architecture/cli.md` |
| 重构路线图 | `docs/architecture/roadmap.md` |
| 版本/发布工作流 | `docs/workflows/versioning-and-release.md` |
| 仓库约束 | `AGENTS.md` |

## Go 入口 smoke 命令

- `go run ./cmd/codex-app --help`
- `go run ./cmd/codex-app doctor`
- `go run ./cmd/codex-app serve --dry-run`

## Legacy

- Bun/TS 入口依然保留：`bun run packages/server/src/index.ts`、`bun run packages/cli/src/main.ts`
