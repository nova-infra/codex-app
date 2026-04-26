# 部署方式

当前部署约定：

- 编译产物进入 `/root/develop/my/codex-app/releases/<version>-<timestamp>/`
- `/root/develop/my/codex-app/current` 始终指向最新发布目录
- systemd 通过 `current/codex-app-server` 启动

## 一键升级

```bash
codex-app-upgrade
```

等价于：

1. 构建新的单文件二进制
2. 更新 `current` 指针
3. 重启 `codex-app.service`

## 回滚

```bash
ln -sfn /root/develop/my/codex-app/releases/<old-release> /root/develop/my/codex-app/current
systemctl restart codex-app.service
```
