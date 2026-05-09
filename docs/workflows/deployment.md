# 部署方式

当前部署约定：

- 编译产物进入 `/root/develop/my/codex-app/releases/<version>-<timestamp>/`
- `/root/develop/my/codex-app/current` 始终指向最新发布目录
- systemd 通过 `current/codex-app-server serve --addr <host:port>` 启动

## 一键升级

```bash
codex-app-upgrade
```

等价于：

1. 使用 `go build` 构建新的单文件二进制
2. 更新 `current` 指针
3. 重启 `codex-app.service`
4. 验证 `GET /health` 和 `GET /version`

## 回滚

```bash
ln -sfn /root/develop/my/codex-app/releases/<old-release> /root/develop/my/codex-app/current
systemctl restart codex-app.service
```

## Lark 服务最小环境

```bash
export LARK_APP_ID="<app-id>"
export LARK_APP_SECRET="<app-secret>"
export LARK_API_BASE="https://open.larksuite.com"
export CODEX_EXEC_MODEL="<low-cost-model>" # 可选
current/codex-app-server serve --addr 127.0.0.1:8787
```

验证：

```bash
curl http://127.0.0.1:8787/health
go test ./...
go vet ./...
```

`/health` 中 `lark_ready=true` 且 `lark_ws_status=running` 表示 Lark 长连接已启动。
