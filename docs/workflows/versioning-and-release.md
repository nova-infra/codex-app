# Versioning and Release Workflow

本仓库已切到 Go-only 发布方式，不再使用 workspace package versioning。

## 版本来源

- 版本号记录在仓库根目录 `VERSION`。
- 发布脚本读取 `VERSION`，并把当前 git sha 写入 `release.json`。

## 本地发布构建

```bash
scripts/release.sh
```

脚本会执行：

1. `go build` 构建 `cmd/codex-app`。
2. 生成 `codex-app-server`。
3. 写入 `release.json`。
4. 更新 `current` 软链到最新 release。
5. 保留最近 5 个 release 目录。

## CI smoke

`.github/workflows/release.yml` 在 PR 和 main push 上运行：

- `go test ./...`
- `go build -o codex-app ./cmd/codex-app`
- `./codex-app help`
- `./codex-app doctor`
- `./codex-app serve --dry-run`

## 部署后验证

服务启动后验证：

- `GET /health`
- `GET /version`
- `GET /config`

## 推荐规则

- 发布前保持工作区干净。
- 生产部署优先使用 clean commit 构建。
- 每次部署后检查 `/health` 或 `/version`。
