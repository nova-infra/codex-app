# Codex App

统一的 Codex 服务层仓库。

## 产品总览

![Codex App Overview (EN)](docs/project/assets/overview.png)

## 入口

- ✅ Go 主线（当前）：
  - `go run ./cmd/codex-app --help`
  - `go run ./cmd/codex-app doctor`
  - `go run ./cmd/codex-app serve --dry-run`

- ⚠️ Bun 主线（legacy，保留迁移对照）：
  - `bun install`
  - `bun run dev` / `bun run cli`

## 文档索引

- 项目状态：`docs/project/status.md`
- 快速启动：`docs/project/getting-started.md`（Bun 入口已废弃，建议先按 Go 主线启动）
- Graph：`graphify-out/GRAPH_REPORT.md`
- 目标架构：`docs/architecture/README.md`
- CLI 架构：`docs/architecture/cli.md`
- 重构路线图：`docs/architecture/roadmap.md`
- 版本/发布工作流：`docs/workflows/versioning-and-release.md`
- 仓库约束：`AGENTS.md`
