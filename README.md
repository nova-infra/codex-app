# Codex App

统一的 Codex 服务层仓库。当前主线已切到 **Go-only**：唯一运行入口是 `cmd/codex-app`，旧前端脚本 workspace 已移除。

![Codex App Overview (EN)](docs/project/assets/overview.png)

## 入口

| 需要了解 | 读这个 |
|---------|--------|
| 项目状态 | `docs/project/status.md` |
| 快速启动 | `docs/project/getting-started.md` |
| 图谱总览 | `graphify-out/GRAPH_REPORT.md` |
| 目标架构 | `docs/architecture/README.md` |
| CLI 架构 | `docs/architecture/cli.md` |
| 部署工作流 | `docs/workflows/deployment.md` |
| 仓库约束 | `AGENTS.md` |

## Go smoke 命令

```bash
go run ./cmd/codex-app help
go run ./cmd/codex-app doctor
go run ./cmd/codex-app serve --dry-run
go run ./cmd/codex-app render-demo --channel all
go run ./cmd/codex-app serve --addr 127.0.0.1:8787
```

服务启动后可访问：

- `GET /health`
- `GET /version`
- `GET /config`
- `GET /render-demo?channel=all`

## 当前 Go 能力

- 支持 JSON 配置加载和 `--config`。
- `doctor` 检查 Go runtime、配置、channel 与社交 channel 凭据环境变量；缺少外部凭据以 warning 呈现。
- `serve --dry-run` 输出 provider/project/channel 装配计划。
- `serve` 非 dry-run 启动真实 Go HTTP 服务。
- 已有 Codex launch command skeleton、文件 session store skeleton 与 channel renderer/runtime skeleton。
