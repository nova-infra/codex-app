# 快速启动

## 最小启动

```bash
go run ./cmd/codex-app doctor
go run ./cmd/codex-app serve --dry-run
```

## 说明

- 当前主线入口已切到 Go 版 `cmd/codex-app`
- `bun run legacy:dev` / `bun run legacy:cli` 仅保留给旧 Bun/TS 入口兼容使用
- `bun run go:smoke` 可执行 Go 入口 smoke：`doctor`、`serve --dry-run`、`render-demo`
- 详细约束、包职责和开发规范统一看 `AGENTS.md`
- 架构和后续重构方向统一看 `docs/architecture/`
