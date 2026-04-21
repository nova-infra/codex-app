# Codex App 架构总览

这份目录描述的是 **目标方案**，不是当前实现。

设计目标：

- 同仓库模块化
- 按配置启用
- `web / wechat / telegram` 都视为 channel plugin
- 主文档只关心总架构和必要模块组合
- channel 细节单独下沉到 `channels/`
- CLI 可以基于 preset 与 agent 装配模块

## 文档导航

- [内核层](/Users/Bigo/Desktop/develop/nova-infra/codex-app/docs/architecture/kernel.md)
- [必要模块组合](/Users/Bigo/Desktop/develop/nova-infra/codex-app/docs/architecture/modules.md)
- [装配与 CLI](/Users/Bigo/Desktop/develop/nova-infra/codex-app/docs/architecture/composition.md)
- [CLI 架构](/Users/Bigo/Desktop/develop/nova-infra/codex-app/docs/architecture/cli.md)
- [重构路线图](/Users/Bigo/Desktop/develop/nova-infra/codex-app/docs/architecture/roadmap.md)
- [Channel 目录](/Users/Bigo/Desktop/develop/nova-infra/codex-app/docs/architecture/channels/README.md)

## 规划边界

- `architecture/` 是当前唯一保留的架构规划主线
- 历史验收、阶段 TODO、旧版总览图不再作为规划依据
- 推进顺序以 `roadmap.md` 为准，图谱用于辅助识别核心节点与拆分优先级

## 总体架构图

```mermaid
flowchart TB
    subgraph Channels["Channel Plugins"]
        WEB["channel-web"]
        WX["channel-wechat"]
        TG["channel-telegram"]
        FUTURE["channel-*"]
    end

    subgraph Kernel["Gateway Kernel"]
        API["Unified Gateway API\nrequest / event / approval contract"]
        SG["Session Guard\nownership / resume / fallback"]
        EP["Event Pipeline\nstream / approval / tool-call / timeline"]
        CFG["Runtime Config\nfeature flags / enabled modules"]
    end

    subgraph Capabilities["Capability Registry"]
        SK["Skill Registry"]
        TOOLS["Tool Registry"]
        MCP["MCP Registry"]
        PROVIDERS["Provider Profiles"]
        STORE["State Adapters"]
    end

    subgraph Runtime["Codex Runtime Layer"]
        CT["Codex Transport"]
        APP["codex app-server"]
    end

    subgraph Ops["Assembly & Ops"]
        CLI["Composable CLI"]
        AGENT["Agent-driven Assembler"]
        PRESET["Presets"]
    end

    WEB --> API
    WX --> API
    TG --> API
    FUTURE --> API

    API --> SG
    API --> EP
    API --> CFG

    SG --> STORE
    EP --> STORE
    EP --> SK
    EP --> TOOLS
    EP --> MCP
    EP --> PROVIDERS

    SK --> CT
    TOOLS --> CT
    MCP --> CT
    PROVIDERS --> CT
    CT --> APP

    CLI --> PRESET
    AGENT --> PRESET
    PRESET --> CFG
```

## 四层职责图

```mermaid
flowchart LR
    subgraph L1["L1 Channel Layer"]
        C1["Input Adapter"]
        C2["Output Renderer"]
        C3["Channel UX"]
    end

    subgraph L2["L2 Gateway Kernel"]
        K1["Contract Router"]
        K2["Permission Guard"]
        K3["Session Runtime"]
        K4["Timeline/Event Bus"]
    end

    subgraph L3["L3 Capability Layer"]
        A1["Skills"]
        A2["Tools"]
        A3["MCP"]
        A4["Provider Profiles"]
        A5["Persistence Adapter"]
    end

    subgraph L4["L4 Runtime Layer"]
        R1["Codex Transport"]
        R2["codex app-server"]
    end

    C1 --> K1
    C2 --> K4
    C3 --> K2

    K1 --> K2
    K1 --> K3
    K3 --> A5
    K4 --> A1
    K4 --> A2
    K4 --> A3
    K4 --> A4

    A1 --> R1
    A2 --> R1
    A3 --> R1
    A4 --> R1
    R1 --> R2
```

## 目标链路

### 主链路

```mermaid
sequenceDiagram
    participant User as Channel User
    participant Channel as channel-*
    participant Kernel as Gateway Kernel
    participant Cap as Capability Registry
    participant RT as Codex Transport
    participant Codex as codex app-server

    User->>Channel: input / action / approval
    Channel->>Kernel: unified request
    Kernel->>Kernel: auth + session guard + contract routing
    Kernel->>Cap: resolve enabled capabilities
    Cap->>RT: invoke codex-facing action
    RT->>Codex: JSON-RPC / event stream
    Codex-->>RT: result + events + approvals
    RT-->>Kernel: normalized events
    Kernel-->>Channel: normalized event stream
    Channel-->>User: channel-specific UX
```

### 装配链路

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant CLI as codex-app CLI
    participant Agent as Assembly Agent
    participant Preset as Preset Config
    participant Runtime as Runtime Config

    Dev->>CLI: assemble web-only
    CLI->>Preset: load preset
    CLI->>Agent: combine modules by preset
    Agent-->>CLI: final module plan
    CLI->>Runtime: write enabled config
    Runtime-->>CLI: bootstrap result
    CLI-->>Dev: enabled channels / modules / next commands
```

## 一句话结论

V2 不是“大一统中台”，而是：

**稳定内核 + 能力注册层 + 可装配 channel + preset 驱动 CLI**
