# Codex 账号切换功能验收标准

对应提交：`b85cf9e feat: enable Codex account switching from the server and Telegram`

## 验收目标

确认新增的 Codex 多账号能力可在 **server HTTP API** 与 **Telegram 命令入口** 正常工作，并且切换活跃账号后能够立即更新本机 `~/.codex/auth.json`，无需重启服务。

## 验收范围

本次验收覆盖：

- `@codex-app/codex-account` 账号管理包
- server 侧 `/codex-account*` HTTP 接口
- Telegram `/cx` 系列命令与 callback 交互
- 活跃账号切换后 `~/.codex/auth.json` 热更新
- token 刷新、账号删除、用量查询的基础闭环

本次验收不覆盖：

- 微信 channel 账号管理入口
- 生产环境压力测试
- OpenAI / ChatGPT 第三方接口可用性稳定性
- 历史账号数据迁移

## 环境准备

验收前需具备：

- 可启动的本地 `codex-app server`
- 可用 Telegram bot
- 至少 2 个可测试的 Codex/OpenAI 账号
- 浏览器可访问本地 OAuth callback 地址
- 允许服务进程写入 `~/.codex/auth.json` 与 `~/.codex-app/codex-accounts.json`
- `OPENAI_API_KEY` 仅作为 `codex app-server` 启动前置条件，验收时可使用任意占位值，无需真实可用 key

## 验收标准

### A. 账号存储与启动行为

1. 服务启动时，如果本地已有已保存账号：
   - 能成功加载账号列表
   - 能识别当前 active account
   - 会将 active account 写入 `~/.codex/auth.json`
   - 启动日志出现当前账号信息

2. 服务启动时，如果本地无账号：
   - 服务能正常启动
   - `/codex-account` 返回空列表而不是报错

### B. HTTP API 验收

#### B1. 查询账号列表
- 请求 `GET /codex-account`
- 期望：
  - 返回 `success: true`
  - `data` 为数组
  - 不暴露敏感 token 字段
  - active account 有明确标记

#### B2. OAuth 登录初始化
- 请求 `POST /codex-account/login`
- 期望：
  - 返回 `authUrl` 与 `state`
  - `authUrl` 可在浏览器打开
  - `state` 可用于后续 callback 关联

#### B3. OAuth callback
- 浏览器完成授权后访问 `/codex-account/callback`
- 期望：
  - 页面显示成功添加账号或明确失败原因
  - 新账号被写入本地账号存储
  - 若为首个账号，则自动成为 active account
  - `~/.codex/auth.json` 被更新

#### B4. refreshToken 导入账号
- 请求 `POST /codex-account/token`，body 为 `{ "refreshToken": "..." }`
- 期望：
  - 可成功创建账号
  - 返回账号基础信息
  - 不回显敏感 token

#### B5. authorization code 导入账号
- 请求 `POST /codex-account/token`，body 为 `{ "code": "...", "codeVerifier": "..." }`
- 期望：
  - 可成功创建账号
  - 行为与 OAuth callback 导入结果一致

#### B6. 切换 active account
- 请求 `POST /codex-account/:id/activate`
- 期望：
  - 返回 success
  - 内存中的 active account 更新
  - `~/.codex/auth.json` 立即更新为目标账号 access token
  - 无需重启 server

#### B7. 用量查询
- 请求 `GET /codex-account/:id/usage`
- 期望：
  - 返回 `session3h`、`weekly`、`limitReached`
  - 若 access token 过期但 refreshToken 有效，可自动刷新并成功返回

#### B8. 删除账号
- 请求 `DELETE /codex-account/:id`
- 期望：
  - 删除成功后列表中不再出现该账号
  - 若删除的是 active account：
    - 自动切换到剩余第一个账号，或
    - 如果已无账号，则清空 `~/.codex/auth.json`

### C. Telegram 命令验收

#### C1. `/cx`
- 期望：返回账号列表；无账号时给出明确引导

#### C2. `/cx login` 与 `/cx_login`
- 期望：
  - 都能触发登录流程
  - Telegram 返回可点击授权按钮
  - 授权成功后 bot 主动回发“授权成功/账号已添加”消息

#### C3. `/cx token <refreshToken>`
- 期望：
  - 可添加账号
  - 成功/失败信息明确

#### C4. `/cx switch` 与按钮回调
- 期望：
  - 展示可切换账号按钮
  - 点击后切换成功
  - 返回当前已切换账号提示
  - `~/.codex/auth.json` 同步更新

#### C5. `/cx usage`
- 期望：
  - 返回所有账号的 3h/weekly 用量
  - 进度条与重置时间展示正常
  - 单个账号失败时不影响其他账号展示

#### C6. `/cx refresh [id]`
- 期望：
  - 不带 id 时刷新所有账号
  - 带 id 时仅刷新目标账号
  - 返回逐项结果

#### C7. `/cx remove`
- 期望：
  - 展示可删除账号按钮
  - 删除后反馈明确
  - 删除 active 账号时行为符合 HTTP API 标准

### D. 数据安全与回归要求

1. `GET /codex-account`、Telegram 列表回复中不得暴露：
   - accessToken
   - refreshToken
   - idToken

2. 对不存在账号的切换、删除、查询请求：
   - 返回明确错误
   - 不得导致服务崩溃

3. 对缺失参数的请求：
   - 返回 4xx
   - 错误信息可读

4. 原有 Telegram 命令不回归：
   - `/bind`
   - `/new`
   - `/model`
   - `/reasoning`
   - `/token`
   - `/project`
   - `/status`
   - `/help`

## 建议验收用例清单

### P0（必须通过）
- [ ] 无账号启动 server
- [ ] OAuth 新增首个账号成功
- [ ] refreshToken 新增第二个账号成功
- [ ] HTTP 切换 active account 后 `~/.codex/auth.json` 立即更新
- [ ] Telegram `/cx switch` 可切换账号
- [ ] Telegram OAuth 成功后收到回推消息
- [ ] 删除 active account 后自动回退或清空 auth 文件

### P1（应通过）
- [ ] `/codex-account/:id/usage` 返回正确结构
- [ ] access token 过期时 usage 查询可自动刷新
- [ ] `/cx usage` 多账号展示正常
- [ ] `/cx refresh` 全量刷新正常
- [ ] 非法账号 id 返回明确错误

### P2（可后补）
- [ ] callback state 过期处理符合预期
- [ ] 重复导入同一 accountId 时走更新而非重复新增
- [ ] 长时间运行后 callbackRegistry 过期清理正常

## 验收结论模板

### 通过
- 结论：通过上线前验收
- 备注：P0 全通过，P1 无阻塞问题

### 有条件通过
- 结论：有条件通过
- 备注：仅存在文案/非阻塞问题，需在下一次提交修复

### 不通过
- 结论：不通过
- 备注：P0 任一失败，或存在 token 泄露 / 切换失效 / 服务崩溃

## 当前已知风险

- 尚未做真实 OAuth 与 Telegram 回调联调验证
- 外部 OpenAI/ChatGPT 接口变更会直接影响登录、刷新、用量能力
- 本次为新增能力，尚未有自动化回归保护

## 验收备注

- 本项目当前验收中，`OPENAI_API_KEY` 只用于满足 `codex app-server` 的启动检查。
- 如仅验证本地 server / HTTP / Telegram 接线是否正常，可直接使用任意非空默认值，例如 `OPENAI_API_KEY=dummy-key`。
- 只有涉及真实 OpenAI / ChatGPT 账号登录、refresh、usage 联调时，才需要真实可用凭证。
