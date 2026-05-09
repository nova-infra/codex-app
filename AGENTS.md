# Codex App Workspace

统一的 Codex 服务层，为 Web / Telegram / 微信提供 AI 编程能力。

## 仓库定位

- `README.md` 只作为索引入口，不承载详细说明
- 当前实现为 Go-only 主线
- 后续规划、模块边界和推进顺序统一以 `docs/architecture/` 为准
- 回答架构或代码结构问题时，优先结合 `graphify-out/GRAPH_REPORT.md` 与 `docs/architecture/`

## 文档路由

| 需要了解 | 读这个 |
|---------|--------|
| 图谱总览 | `graphify-out/GRAPH_REPORT.md` |
| 目标架构 | `docs/architecture/README.md` |
| CLI 架构 | `docs/architecture/cli.md` |
| 重构路线图 | `docs/architecture/roadmap.md` |
| 版本/发布工作流 | `docs/workflows/versioning-and-release.md` |

## 文档语言

- 默认使用中文编写文档、说明和规划内容
- 只有在需要对外发布、对接英文资料或用户明确要求时，才补充英文版本

## 架构概览

```text
Web/API ──http──▸ codex-app Go service ──▸ Codex runtime skeleton
TG Bot ──long polling──▸ Go channel runtime
微信 ──iLink long polling──▸ Go channel runtime
```

无需公网 IP，无需穿透。

## 当前主线

- Go 服务可直接启动
- 稳定内核
- capability registry
- channel plugin
- preset 驱动装配

## 主要目录

| 路径 | 说明 |
|---|---|
| `cmd/codex-app/` | Go CLI / 服务入口 |
| `internal/server/` | HTTP 服务、启动计划、服务端 endpoints |
| `internal/runtime/` | startup plan、doctor、channel readiness |
| `internal/channel/` | channel renderer 与 runtime adapter |
| `internal/render/` | Codex event 到平台消息的渲染模型 |
| `internal/config/` | JSON 配置加载、环境变量覆盖 |
| `internal/project/` | project 配置与 CODEX_HOME 处理 |
| `internal/provider/` | provider 配置与解析 |
| `internal/session/` | session 配置与文件存储 |

## 开发规范

- 运行时: Go
- 常规验证: `go test ./...`
- 开发阶段直接 `go run ./cmd/codex-app ...`
- 发布构建使用 `go build`，由 `scripts/release.sh` 生成二进制
- 不可变数据: 尽量避免原地 mutation，优先返回新对象
- 文件上限: 400 行，函数上限: 50 行
- 错误处理: 显式处理，不吞异常

## Go 命令

```bash
go run ./cmd/codex-app help
go run ./cmd/codex-app doctor
go run ./cmd/codex-app serve --dry-run
go run ./cmd/codex-app serve --addr 127.0.0.1:8787
go test ./...
```

## Import 规范

- Go 包使用 module path：`github.com/nova-infra/codex-app/...`
- 不新增跨层循环依赖
- channel 之间不互相依赖

## 提交规范

```text
<type>: <description>
```

类型: feat, fix, refactor, docs, chore

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"` to keep the graph current
