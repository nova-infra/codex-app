/**
 * Notification handlers for codex events.
 * Handles: tool progress, streaming text deltas, turn completion, token usage.
 */

import type { CodexClient } from '@codex-app/core'
import type { TelegramSender } from '@/sender'
import { createStreamingState, finalizeStreamingState, type StreamingState, type TelegramStreamingConfig } from '@/streaming'
import { markdownToTelegramHtml, splitTelegramMessage } from '@/format'

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
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function extractThreadId(n: { readonly params: unknown }): string {
  const p = asRecord(n.params)
  if (!p) return ''
  if (typeof p.threadId === 'string') return p.threadId
  if (typeof p.thread_id === 'string') return p.thread_id
  if (typeof p.conversationId === 'string') return p.conversationId
  if (typeof p.conversation_id === 'string') return p.conversation_id
  const thread = asRecord(p.thread)
  if (typeof thread?.id === 'string') return thread.id
  const turn = asRecord(p.turn)
  if (typeof turn?.threadId === 'string') return turn.threadId
  return typeof turn?.thread_id === 'string' ? turn.thread_id : ''
}

const TOOL_ICONS: Record<string, string> = {
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

function formatItemLabel(item: Record<string, unknown>): string | null {
  const type = typeof item.type === 'string' ? item.type : ''
  const icon = TOOL_ICONS[type] ?? ''
  if (!icon) return null

  switch (type) {
    case 'commandExecution': {
      const cmd = typeof item.command === 'string' ? item.command : ''
      return `${icon} ${cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd || '执行命令'}`
    }
    case 'fileChange': {
      const changes = Array.isArray(item.changes) ? item.changes : []
      const first = asRecord(changes[0])
      const file = typeof first?.filePath === 'string' ? first.filePath : ''
      const name = file ? file.split('/').pop() : ''
      const label = name ? `修改 ${name}` : '修改文件'
      return changes.length > 1 ? `${icon} ${label} (+${changes.length - 1})` : `${icon} ${label}`
    }
    case 'mcpToolCall': {
      const tool = typeof item.tool === 'string' ? item.tool : ''
      const server = typeof item.server === 'string' ? item.server : ''
      return `${icon} ${tool || server || '工具调用'}`
    }
    case 'webSearch':
      return `${icon} 搜索网页`
    case 'reasoning':
      return `${icon} Thinking...`
    case 'plan':
      return `${icon} 制定计划`
    default:
      return `${icon} ${type}`
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

  const label = formatItemLabel(item)
  if (!label) return

  const progress = ctx.turnProgress.get(threadId)
  if (progress) {
    const steps = [...progress.steps, `⏳ ${label}`]
    const now = Date.now()
    if (now - progress.lastEditAt > 800) {
      await ctx.sender.editMessageText(progress.chatId, progress.messageId, steps.join('\n'))
      ctx.turnProgress.set(threadId, { ...progress, steps, lastEditAt: now })
    } else {
      ctx.turnProgress.set(threadId, { ...progress, steps })
    }
  } else {
    const chatId = chatIds.values().next().value!
    const msgId = await ctx.sender.sendMessage(chatId, `⏳ ${label}`)
    if (msgId) {
      ctx.turnProgress.set(threadId, {
        chatId, messageId: msgId, steps: [`⏳ ${label}`], lastEditAt: Date.now(),
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

  const label = formatItemLabel(item)
  if (!label) return

  const steps = progress.steps.map(s => (s === `⏳ ${label}` ? `✅ ${label}` : s))
  const now = Date.now()
  if (now - progress.lastEditAt > 800) {
    await ctx.sender.editMessageText(progress.chatId, progress.messageId, steps.join('\n'))
    ctx.turnProgress.set(threadId, { ...progress, steps, lastEditAt: now })
  } else {
    ctx.turnProgress.set(threadId, { ...progress, steps })
  }
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

  const html = markdownToTelegramHtml(raw)
  const segments = splitTelegramMessage(html)

  if (progress) {
    await ctx.sender.editMessageText(progress.chatId, progress.messageId, segments[0], 'HTML')
    for (let i = 1; i < segments.length; i++) {
      await ctx.sender.sendMessage(progress.chatId, segments[i], { parse_mode: 'HTML' })
    }
  } else {
    for (const chatId of chatIds) {
      for (const seg of segments) {
        await ctx.sender.sendMessage(chatId, seg, { parse_mode: 'HTML' })
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

export async function handleNotification(
  n: { readonly method: string; readonly params: unknown },
  ctx: NotificationContext,
): Promise<void> {
  const threadId = extractThreadId(n)
  switch (n.method) {
    case 'item/agentMessage/delta':
      await onAgentMessageDelta(threadId, n.params, ctx)
      break
    case 'item/reasoning/summaryTextDelta':
      // Ignore reasoning summary deltas. The corresponding item/started event
      // already creates the single progress card we want to show in Telegram.
      break
    case 'item/started':
      await onItemStarted(threadId, n.params, ctx)
      break
    case 'item/completed':
      await onItemCompleted(threadId, n.params, ctx)
      break
    case 'turn/completed':
      await onTurnCompleted(threadId, n.params, ctx)
      break
    case 'error':
      await onError(threadId, n.params, ctx)
      break
    case 'thread/tokenUsage/updated':
      await onTokenUsage(threadId, n.params, ctx)
      break
  }
}
