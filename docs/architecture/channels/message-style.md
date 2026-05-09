# Channel 消息样式规范

WeChat、Telegram、Feishu / Lark 的返回消息样式统一参考：

```text
/Users/Bigo/Desktop/develop/ai/hermes-agent/gateway/display_config.py
/Users/Bigo/Desktop/develop/ai/hermes-agent/gateway/stream_consumer.py
/Users/Bigo/Desktop/develop/ai/hermes-agent/gateway/platforms/helpers.py
/Users/Bigo/Desktop/develop/ai/hermes-agent/gateway/platforms/feishu.py
/Users/Bigo/Desktop/develop/ai/hermes-agent/gateway/platforms/telegram.py
```

目标不是照搬 Python 实现，而是把 Hermes Gateway 的展示策略固化成 codex-app 的 channel renderer 约束。

## 总原则

所有社交 channel 必须遵守：

1. **默认隐藏 reasoning / thinking**
   - 不把 `<think>`、`<reasoning>`、`REASONING_SCRATCHPAD` 等内容发给用户。
   - reasoning summary 只允许作为内部调试能力，默认关闭。

2. **工具进度与最终回答分层**
   - tool / command / MCP 进度是状态提示，不混进最终回答正文。
   - 工具边界后，最终回答必须作为新的内容段落出现在进度之后。

3. **少打扰**
   - 支持编辑的平台优先编辑同一条进度消息。
   - 不支持编辑的平台不要刷大量永久进度消息。
   - 失败时可以保留错误线索；成功时避免留下无意义的状态垃圾。

4. **长文本分块**
   - 按平台限制分块，尽量在段落或换行边界切开。
   - 不在用户侧暴露内部 chunk / stream 细节。

5. **媒体标记不外泄**
   - `MEDIA:`、音频占位、图片生成内部字段不能直接出现在文本回复里。
   - 图片 / 文件应走 channel 的 attachment 能力；不支持时回退为清晰文本说明。

6. **Markdown 按平台降级**
   - Telegram 可以用 HTML / MarkdownV2 渲染。
   - Feishu / Lark 优先卡片或富文本，失败时文本 fallback。
   - WeChat 只发可读纯文本，去除 Markdown 装饰但保留代码和链接含义。

## 平台默认策略

| Channel | Hermes tier | tool progress | reasoning | streaming / edit | preview length | 输出形态 |
|---|---|---|---|---|---:|---|
| Telegram | high | all | off | on | 40 | HTML / Markdown + editMessage |
| Feishu / Lark | medium | new | off | on | 40 | card / rich text，失败文本 fallback |
| WeChat | low | off | off | off | 40 | 纯文本 + 必要图片 / 文件 |

解释：

- Telegram 适合展示完整进度，但应通过编辑同一条消息降低噪音。
- Feishu / Lark 面向团队协作，默认只展示新工具/阶段级进度，避免工作群刷屏。
- WeChat/iLink 不适合流式编辑，默认只保留 typing 与最终结果；不要把每个 tool-call 发成永久消息。

## Telegram 样式

Telegram 采用 Hermes high tier：

- 默认 `renderMode = hermes`。
- 最终回答用 Telegram HTML 优先渲染。
- 进度可以展示，但应编辑同一条消息。
- reasoning 默认不展示。
- approval 使用 inline keyboard。
- 长回复按 Telegram 限制拆成多条。

推荐用户观感：

```text
⚙️ bun run ...
```

随后：

```text
已完成。关键变更如下：
...
```

不要出现：

```text
<reasoning>...</reasoning>
Thinking...
```

## WeChat 样式

WeChat 采用 Hermes low tier：

- 不展示 tool progress。
- 不展示 reasoning / thinking。
- 不做流式回复。
- 只在必要时保留 typing indicator。
- 最终回答转换为纯文本并按 iLink 限制分块。
- approval 使用数字菜单：`1 确认 / 2 拒绝`。
- 图片生成结果走图片 relay，不把内部 URL/JSON 当正文发出。

推荐用户观感：

```text
已完成。关键变更如下：
...
```

需要审批时：

```text
[exec] 需要执行命令：bun run ...

回复 1 确认，2 拒绝
```

不要出现连续的：

```text
⚙️ 执行命令...
🧰 调用工具...
🧠 Thinking...
```

## Feishu / Lark 样式

Feishu / Lark 采用 Hermes medium tier，当前只作为 `channel-lark` 规划约束：

- 默认 `tool_progress = new`，只展示新阶段，不展示每次重复更新。
- 默认隐藏 reasoning。
- 支持卡片时用卡片承载 approval / status；失败时 fallback 到文本。
- 支持编辑时优先编辑同一条状态消息。
- 群聊里要保留 reply/thread 上下文，不把 thread 语义放进 kernel。
- 富文本不可用时，回退为清晰纯文本：`[Rich text message]` 类占位不能成为最终用户回复。

## Renderer 落点

长期应抽出统一 renderer profile：

```ts
export type ChannelDisplayTier = 'high' | 'medium' | 'low' | 'minimal'

export type ChannelDisplayProfile = {
  readonly toolProgress: 'all' | 'new' | 'off'
  readonly showReasoning: boolean
  readonly streaming: boolean
  readonly toolPreviewLength: number
  readonly cleanupProgress: boolean
}
```

Channel 只读取 profile 决定展示方式，不在 adapter 里私自发明格式。
