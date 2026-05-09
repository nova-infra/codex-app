# Codex 账号切换验收清单

适用 commit：`b85cf9e feat: enable Codex account switching from the server and Telegram`

## 验收目标

确认 codex-app 已支持从 Server 与 Telegram 入口触发 Codex 账号切换，并且账号状态、OAuth 回调、使用量查询和 Telegram 命令链路可用。

## 验收前置

- 已配置 Telegram Bot token 与允许访问的用户。
- 已配置 Codex 账号 OAuth 所需环境变量。
- Server 可正常启动。
- Telegram Bot long polling 可正常收发消息。

## 验收步骤

1. 启动服务。
2. 在 Telegram 中发送账号相关命令，确认能看到账号列表或登录提示。
3. 触发登录流程，确认返回 OAuth 授权链接。
4. 完成 OAuth 授权，确认回调可被 Server 接收。
5. 再次查询账号状态，确认当前账号已记录。
6. 触发账号切换，确认 Telegram 返回切换结果。
7. 查询使用量，确认能返回当前账号的 usage 信息或明确错误。
8. 重启服务后再次查询账号，确认本地 store 状态仍可读取。

## 通过标准

- Telegram 账号命令可用，不报未注册命令。
- OAuth 链接生成成功。
- OAuth 回调处理成功。
- 账号状态可查询、可切换。
- 使用量查询返回正常结果，或在上游不可用时返回明确错误。
- 重启后账号状态不丢失。
- 非授权 Telegram 用户无法操作账号切换。

## 回归关注

- Telegram 普通 Codex 对话不受账号命令影响。
- Server 原有 WebSocket / channel 启动流程不因账号模块失败而整体崩溃。
- 缺少 OAuth 环境变量时应显式报错，不应吞异常。

## 验收结论

- [ ] 通过
- [ ] 不通过

备注：

