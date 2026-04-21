# CLI 架构

这份文件只回答一个问题：

**`codex-app` CLI 应该如何标准化，才能既能装配模块，也能作为长期稳定的命令层。**

## 定位

- 二进制名：`codex-app`
- 实现语言：`TypeScript + Bun`
- 角色：本地装配器、检查器、配置读写入口
- 非目标：不复制一套 server，不接管 channel 运行时，不绕过 kernel contract

## 为什么用 TypeScript + Bun

当前仓库本身就是 Bun/TypeScript workspace，CLI 需要复用现有配置模型、preset 定义和模块边界；继续沿用 Bun/TS，比额外引入 Rust CLI 更稳，也更低摩擦。

## 第一批真实任务

CLI 第一批只做这些可复用任务：

- 检查当前环境是否能启动 `codex-app`
- 枚举 preset、channel、capability
- 读取当前装配配置
- 以 dry-run 或 apply 方式生成目标配置
- 启动 runtime
- 提供一个受限的原始配置补丁入口

## 命令面

遵循 `cli-creator` 的 discover / read / write / raw 结构：

### Discovery

```bash
codex-app preset list
codex-app channel list
codex-app capability list
```

### Resolve / Read

```bash
codex-app preset show web-only
codex-app channel show wechat
codex-app capability show skills
codex-app config view
codex-app config get runtime.gateway.transport
```

### Write

```bash
codex-app assemble apply web-only
codex-app assemble apply custom --channels web,wechat --capabilities skills,tools --dry-run
codex-app runtime start
```

### Raw Escape Hatch

```bash
codex-app request config-patch --file ./config.patch.json --dry-run
```

原始入口只允许：

- 配置层 patch
- 默认 `--dry-run`
- 不直接代理任意运行时写操作

## 顶层命令分组

```text
codex-app
  doctor
  init
  preset
  channel
  capability
  config
  assemble
  runtime
  request
```

## 各命令职责

### `doctor`

用途：

- 检查 Bun、Codex CLI、配置文件、工作目录、端口占用、必要运行目录

要求：

- `codex-app --json doctor` 必须可机器读取
- 就算缺配置也不能崩，只能返回缺失项

### `init`

用途：

- 初始化本地配置目录
- 写入最小 config skeleton

要求：

- 只初始化，不做装配决策
- 不隐式启用额外 channel

### `preset`

用途：

- 枚举和展示预置方案

要求：

- 只读
- 输出 preset 的 channels、capabilities、runtime patch

### `channel`

用途：

- 展示 channel 元信息

要求：

- 描述 channel 是否默认启用
- 描述依赖的 capability 和 runtime 要求

### `capability`

用途：

- 展示 capability 元信息

要求：

- 描述 capability 依赖
- 描述是否会改变 runtime 行为

### `config`

用途：

- 查看当前配置
- 获取某个配置路径

要求：

- 默认只读
- `view` 返回完整配置快照
- `get` 只返回单路径值

### `assemble`

用途：

- 根据 preset 或自定义参数生成目标配置

要求：

- 默认支持 `--dry-run`
- `apply` 才真的写文件
- 结果必须列出启用的 channel、capability、runtime patch

### `runtime`

用途：

- 启动当前装配结果对应的服务

要求：

- 只读取已确定配置
- 不在 `runtime start` 里偷偷改配置

### `request`

用途：

- 保留原始逃生口

要求：

- 不成为主接口
- 只服务于高阶命令还没覆盖到的场景

## JSON 输出约定

所有命令支持 `--json`。

### 成功输出

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "command": "preset list"
  }
}
```

### 失败输出

```json
{
  "ok": false,
  "error": {
    "code": "CONFIG_NOT_FOUND",
    "message": "config file not found",
    "hint": "run codex-app init"
  }
}
```

约束：

- JSON 只写 stdout
- 诊断信息走 stderr
- 不能输出 token、cookie、敏感路径内容

## 配置优先级

这个 CLI 不是 API client，优先处理的是本地装配配置。

推荐优先级：

1. 显式 flag
2. 环境变量
3. `~/.codex-app/config.json`
4. preset 默认值

建议保留的环境变量：

- `CODEX_APP_CONFIG`
- `CODEX_APP_DATA_DIR`
- `CODEX_APP_PRESET`

## 包结构

推荐新增独立包：

```text
packages/cli/
  src/
    main.ts
    app/
      commandRegistry.ts
      context.ts
    commands/
      doctor.ts
      init.ts
      preset.ts
      channel.ts
      capability.ts
      config.ts
      assemble.ts
      runtime.ts
      request.ts
    services/
      doctorService.ts
      presetRegistry.ts
      moduleRegistry.ts
      configService.ts
      runtimeService.ts
    output/
      json.ts
      text.ts
    schemas/
      cliConfig.ts
      cliResult.ts
```

## 依赖边界

CLI 层只应该依赖这些稳定能力：

- preset registry
- module registry
- config service
- runtime bootstrap
- doctor probes

CLI 不应该直接依赖：

- `channel-telegram` 或 `channel-wechat` 的 adapter 细节
- sender / poller 实现
- 临时文件格式拼装逻辑

## 与现有架构的关系

CLI 在总架构里属于 `Assembly & Ops` 层：

- 它写 runtime config
- 它读取模块注册表
- 它不直接拥有 kernel contract

也就是说：

- `CLI` 决定启用什么
- `Kernel` 决定怎么运行
- `Channel` 决定怎么适配输入输出

## 实施顺序

1. 先抽 `preset registry` 和 `module registry`
2. 再做 `doctor`、`preset`、`config`
3. 再做 `assemble apply --dry-run`
4. 最后补 `runtime start` 和 `request config-patch`

## 一句话结论

标准化后的 CLI 不再只是“几个装配命令”，而是：

**一个围绕 preset、module registry、config 和 doctor 构建的稳定命令层。**
