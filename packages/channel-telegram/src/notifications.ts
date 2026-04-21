/**
 * Notification handlers for codex events.
 * Handles: tool progress, streaming text deltas, turn completion, token usage.
 */

import type { CodexClient, RuntimeEvent } from '@codex-app/core'
import type { TelegramSender } from '@/sender'
import { createStreamingState, finalizeStreamingState, type StreamingState, type TelegramStreamingConfig } from '@/streaming'
import { renderTelegramHtmlSegments, renderTelegramMarkdownSegments } from '@/format'

export type TurnProgress = {
  chatId: number
  messageId: number
  steps: string[]
  lastEditAt: number
}

export type NotificationContext = {
  readonly sender: TelegramSender
  readonly codex: CodexClient
  readonly threadToChats: ReadonlyMap<string, ReadonlySet<number>>
  readonly turnProgress: Map<string, TurnProgress>
  readonly lastForwardedTurn: Map<string, string>
  readonly streaming: Map<string, StreamingState>
  readonly stopTyping: (chatId: number) => void
  readonly readLatestReply: (threadId: string) => Promise<string>
  readonly streamingConfig?: TelegramStreamingConfig
  readonly renderMode: 'classic' | 'hermes'
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

const TOOL_ICONS_CLASSIC: Record<string, string> = {
  commandExecution: '🔧',
  fileChange: '📝',
  mcpToolCall: '🔌',
  webSearch: '🔍',
  reasoning: '💭',
  imageView: '🖼',
  imageGeneration: '🎨',
  dynamicToolCall: '⚡',
  plan: '📋',
}

const TOOL_ICONS_HERMES: Record<string, string> = {
  commandExecution: '⚙️',
  fileChange: '✏️',
  mcpToolCall: '🧰',
  webSearch: '🔎',
  reasoning: '🧠',
  imageView: '🖼️',
  imageGeneration: '🖼️',
  dynamicToolCall: '🛠️',
  plan: '📌',
}

function foldProgressSteps(steps: readonly string[]): string[] {
  if (steps.length <= 4) return [...steps]
  return [`… 前 ${steps.length - 3} 步已折叠`, ...steps.slice(-3)]
}

function formatItemLabel(item: Record<string, unknown>, mode: 'classic' | 'hermes'): string | null {
  const type = typeof item.type === 'string' ? item.type : ''
  const icons = mode === 'hermes' ? TOOL_ICONS_HERMES : TOOL_ICONS_CLASSIC
  const icon = icons[type] ?? ''
  if (!icon) return null

  switch (type) {
    case 'commandExecution': {
      const cmd = typeof item.command === 'string' ? item.command : ''
      const text = cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd || '执行命令'
      return mode === 'hermes' ? `${icon} Running: ${text}` : `${icon} ${text}`
    }
    case 'fileChange': {
      const changes = Array.isArray(item.changes) ? item.changes : []
      const first = asRecord(changes[0])
      const file = typeof first?.filePath === 'string' ? first.filePath : ''
      const name = file ? file.split('/').pop() : ''
      const label = name ? `修改 ${name}` : '修改文件'
      const text = changes.length > 1 ? `${label} (+${changes.length - 1})` : label
      return mode === 'hermes' ? `${icon} Editing: ${text}` : `${icon} ${text}`
    }
    case 'mcpToolCall': {
      const tool = typeof item.tool === 'string' ? item.tool : ''
      const server = typeof item.server === 'string' ? item.server : ''
      const text = tool || server || '工具调用'
      return mode === 'hermes' ? `${icon} Tool: ${text}` : `${icon} ${text}`
    }
    case 'webSearch':
      return mode === 'hermes' ? `${icon} Search in progress` : `${icon} 搜索网页`
    case 'reasoning':
      return mode === 'hermes' ? `${icon} Thinking` : `${icon} Thinking...`
    case 'plan':
      return mode === 'hermes' ? `${icon} Planning` : `${icon} 制定计划`
    default:
      return `${icon} ${type}`
  }
}

function collectImageUrls(value: unknown): string[] {
  if (typeof value === 'string') {
    const text = value.trim()
    return /^https?:\/\//.test(text) ? [text] : []
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectImageUrls)
  }
  const rec = asRecord(value)
  if (!rec) return []
  return [
    ...collectImageUrls(rec.imageUrl),
    ...collectImageUrls(rec.image_url),
    ...collectImageUrls(rec.full_url),
    ...collectImageUrls(rec.url),
    ...collectImageUrls(rec.result),
    ...collectImageUrls(rec.output),
    ...collectImageUrls(rec.content),
    ...collectImageUrls(rec.item),
  ]
}

async function maybeSendImage(threadId: string, params: unknown, ctx: NotificationContext): Promise<void> {
  if (!threadId) return
  const chatIds = ctx.threadToChats.get(threadId)
  if (!chatIds?.size) return
  const item = asRecord(asRecord(params)?.item)
  if (!item) return
  const type = typeof item.type === 'string' ? item.type : ''
  if (type !== 'imageGeneration' && type !== 'imageView') return
  const urls = [...new Set(collectImageUrls(item))]
  if (!urls.length) return
  for (const chatId of chatIds) {
    for (const url of urls.slice(0, 4)) {
      await ctx.sender.sendPhoto(chatId, url)
    }
  }
}

async function onItemStarted(threadId: string, params: unknown, ctx: NotificationContext): Promise<void> {
  if (!threadId) return
  const chatIds = ctx.threadToChats.get(threadId)
  if (!chatIds?.size) return
  const p = asRecord(params)
  const item = asRecord(p?.item)
  if (!item) return
  console.log(`[telegram] item/started type=${item.type} cmd=${typeof item.command === 'string' ? item.command.slice(0, 40) : ''}`)

  const label = formatItemLabel(item, ctx.renderMode)
  if (!label) return

  const progress = ctx.turnProgress.get(threadId)
  if (progress) {
    const marker = ctx.renderMode === 'hermes' ? '•' : '⏳'
    const steps = foldProgressSteps([...progress.steps, `${marker} ${label}`])
    const now = Date.now()
    if (now - progress.lastEditAt > 800) {
      await ctx.sender.editMessageText(progress.chatId, progress.messageId, steps.join('\n'))
      ctx.turnProgress.set(threadId, { ...progress, steps, lastEditAt: now })
    } else {
      ctx.turnProgress.set(threadId, { ...progress, steps })
    }
  } else {
    const chatId = chatIds.values().next().value!
    const marker = ctx.renderMode === 'hermes' ? '•' : '⏳'
    const msgId = await ctx.sender.sendMessage(chatId, `${marker} ${label}`)
    if (msgId) {
      ctx.turnProgress.set(threadId, {
        chatId, messageId: msgId, steps: [`${marker} ${label}`], lastEditAt: Date.now(),
      })
    }
  }
}

async function onItemCompleted(threadId: string, params: unknown, ctx: NotificationContext): Promise<void> {
  if (!threadId) return
  const progress = ctx.turnProgress.get(threadId)
  if (!progress) return
  const p = asRecord(params)
  const item = asRecord(p?.item)
  if (!item) return

  const label = formatItemLabel(item, ctx.renderMode)
  if (!label) return

  const started = ctx.renderMode === 'hermes' ? `• ${label}` : `⏳ ${label}`
  const completed = ctx.renderMode === 'hermes' ? `✓ ${label}` : `✅ ${label}`
  const steps = foldProgressSteps(progress.steps.map(s => (s === started ? completed : s)))
  const now = Date.now()
  if (now - progress.lastEditAt > 800) {
    await ctx.sender.editMessageText(progress.chatId, progress.messageId, steps.join('\n'))
    ctx.turnProgress.set(threadId, { ...progress, steps, lastEditAt: now })
  } else {
    ctx.turnProgress.set(threadId, { ...progress, steps })
  }
  await maybeSendImage(threadId, params, ctx)
}

// ---------------------------------------------------------------------------
// Streaming delta handlers
// ---------------------------------------------------------------------------

function getOrCreateStreaming(threadId: string, ctx: NotificationContext): StreamingState | null {
  const existing = ctx.streaming.get(threadId)
  if (existing) return existing

  const chatIds = ctx.threadToChats.get(threadId)
  if (!chatIds?.size) {
    console.log(`[stream] no chatIds for thread=${threadId.slice(0, 8)}, threadToChats keys: [${[...ctx.threadToChats.keys()].map(k => k.slice(0, 8)).join(', ')}]`)
    return null
  }
  const chatId = chatIds.values().next().value!

  // If there's a progress message (tool steps), let the editor reuse it
  const progress = ctx.turnProgress.get(threadId)

  const state = createStreamingState(
    ctx.sender,
    chatId,
    ctx.streamingConfig,
    progress?.messageId,
  )

  if (progress) ctx.turnProgress.delete(threadId)
  ctx.streaming.set(threadId, state)
  return state
}

async function onAgentMessageDelta(threadId: string, params: unknown, ctx: NotificationContext): Promise<void> {
  if (!threadId) return
  const p = asRecord(params)
  const delta = typeof p?.delta === 'string' ? p.delta : ''
  if (!delta) return
  if (ctx.renderMode === 'hermes') return

  const s = getOrCreateStreaming(threadId, ctx)
  if (!s) return
  await s.coalescer.feed(delta)
}

// ---------------------------------------------------------------------------
// Turn completed — finalize streaming or fallback to full read
// ---------------------------------------------------------------------------

async function onTurnCompleted(threadId: string, params: unknown, ctx: NotificationContext): Promise<void> {
  if (!threadId) return
  const chatIds = ctx.threadToChats.get(threadId)
  if (!chatIds?.size) return

  const turn = asRecord(asRecord(params)?.turn)
  const turnId = typeof turn?.id === 'string' ? turn.id : ''
  if (turnId && ctx.lastForwardedTurn.get(threadId) === turnId) return

  for (const chatId of chatIds) ctx.stopTyping(chatId)

  // Finalize streaming if active
  const streaming = ctx.streaming.get(threadId)
  if (streaming) {
    console.log(`[stream] finalizing: fullText=${streaming.editor.fullText.length} chars`)
    await finalizeStreamingState(streaming)
    ctx.streaming.delete(threadId)
    // If editor had content, we're done — streaming delivered the text
    if (streaming.editor.hasContent) {
      ctx.turnProgress.delete(threadId)
      if (turnId) ctx.lastForwardedTurn.set(threadId, turnId)
      return
    }
  }

  // Fallback: no streaming content → read full reply (same as before)
  const raw = await ctx.readLatestReply(threadId)
  const progress = ctx.turnProgress.get(threadId)
  ctx.turnProgress.delete(threadId)

  if (!raw) return

  const segments = ctx.renderMode === 'hermes'
    ? renderTelegramHtmlSegments(raw)
    : renderTelegramMarkdownSegments(raw)

  if (progress) {
    if (ctx.renderMode === 'hermes') {
      await ctx.sender.editHtmlMessage(progress.chatId, progress.messageId, segments[0])
    } else {
      await ctx.sender.editRichMessage(progress.chatId, progress.messageId, segments[0])
    }
    for (let i = 1; i < segments.length; i++) {
      if (ctx.renderMode === 'hermes') {
        await ctx.sender.sendHtmlMessage(progress.chatId, segments[i])
      } else {
        await ctx.sender.sendRichMessage(progress.chatId, segments[i])
      }
    }
  } else {
    for (const chatId of chatIds) {
      for (const seg of segments) {
        if (ctx.renderMode === 'hermes') {
          await ctx.sender.sendHtmlMessage(chatId, seg)
        } else {
          await ctx.sender.sendRichMessage(chatId, seg)
        }
      }
    }
  }

  if (turnId) ctx.lastForwardedTurn.set(threadId, turnId)
}

async function onTokenUsage(threadId: string, params: unknown, ctx: NotificationContext): Promise<void> {
  if (!threadId) return
  const usage = asRecord(asRecord(params)?.tokenUsage)
  const used = typeof usage?.used === 'number' ? usage.used : 0
  const total = typeof usage?.total === 'number' ? usage.total : 0
  if (!total || used / total < 0.8) return
  const pct = Math.round((used / total) * 100)
  const chatIds = ctx.threadToChats.get(threadId)
  if (!chatIds?.size) return
  const keyboard = {
    inline_keyboard: [[
      { text: '压缩继续', callback_data: 'ctx:compact' },
      { text: '开新会话', callback_data: 'ctx:new' },
      { text: '先不管', callback_data: 'ctx:ignore' },
    ]],
  }
  for (const chatId of chatIds) {
    await ctx.sender.sendMessage(chatId, `会话上下文使用率 ${pct}%，建议处理：`, keyboard)
  }
}

function extractErrorMessage(params: unknown): string {
  const p = asRecord(params)
  const error = asRecord(p?.error)
  if (typeof error?.message === 'string' && error.message.trim()) return error.message.trim()
  if (typeof p?.message === 'string' && p.message.trim()) return p.message.trim()
  if (typeof p?.code === 'string' && p.code.trim()) return p.code.trim()
  if (typeof p?.code === 'number') return `error code ${p.code}`
  return '本次请求失败，未返回可展示内容。'
}

async function onError(threadId: string, params: unknown, ctx: NotificationContext): Promise<void> {
  if (!threadId) return
  const chatIds = ctx.threadToChats.get(threadId)
  if (!chatIds?.size) return

  const progress = ctx.turnProgress.get(threadId)
  ctx.turnProgress.delete(threadId)
  const message = `错误：${extractErrorMessage(params)}`

  for (const chatId of chatIds) ctx.stopTyping(chatId)

  if (progress) {
    await ctx.sender.editMessageText(progress.chatId, progress.messageId, message)
    return
  }
  for (const chatId of chatIds) {
    await ctx.sender.sendMessage(chatId, message)
  }
}

async function onApprovalRequest(event: RuntimeEvent, ctx: NotificationContext): Promise<void> {
  if (!event.threadId || event.requestId === undefined) return
  const chatIds = ctx.threadToChats.get(event.threadId)
  if (!chatIds?.size) return
  const params = asRecord(event.raw.params)
  const description = typeof params?.description === 'string'
    ? params.description.trim()
    : '需要确认操作'
  const label = event.method.replace('Approval', '')
  const keyboard = {
    inline_keyboard: [[
      { text: '确认', callback_data: `approval:${event.requestId}:approve` },
      { text: '拒绝', callback_data: `approval:${event.requestId}:reject` },
    ]],
  }
  for (const chatId of chatIds) {
    await ctx.sender.sendMessage(chatId, `[${label}] ${description}`, keyboard)
  }
}

export async function handleNotification(
  event: RuntimeEvent,
  ctx: NotificationContext,
): Promise<void> {
  const threadId = event.threadId ?? ''
  if (event.kind === 'approval_request') {
      await onApprovalRequest(event, ctx)
      return
  }
  switch (event.method) {
    case 'item/agentMessage/delta':
      await onAgentMessageDelta(threadId, event.raw.params, ctx)
      break
    case 'item/reasoning/summaryTextDelta':
      // Ignore reasoning summary deltas. The corresponding item/started event
      // already creates the single progress card we want to show in Telegram.
      break
    case 'item/started':
      await onItemStarted(threadId, event.raw.params, ctx)
      break
    case 'item/completed':
      await onItemCompleted(threadId, event.raw.params, ctx)
      break
    case 'turn/completed':
      await onTurnCompleted(threadId, event.raw.params, ctx)
      break
    case 'error':
      await onError(threadId, event.raw.params, ctx)
      break
    case 'thread/tokenUsage/updated':
      await onTokenUsage(threadId, event.raw.params, ctx)
      break
  }
}
