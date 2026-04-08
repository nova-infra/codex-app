/**
 * Notification handlers for codex events (tool progress, turn completion, token usage).
 * Stateless functions that receive a NotificationContext from the adapter.
 */

import type { CodexClient } from '@codex-app/core'
import type { TelegramSender } from '@/sender'
import { markdownToTelegramHtml } from '@/format'

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
  readonly stopTyping: (chatId: number) => void
  readonly readLatestReply: (threadId: string) => Promise<string>
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
  const turn = asRecord(p.turn)
  return typeof turn?.threadId === 'string' ? turn.threadId : ''
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

async function onTurnCompleted(threadId: string, params: unknown, ctx: NotificationContext): Promise<void> {
  if (!threadId) return
  const chatIds = ctx.threadToChats.get(threadId)
  if (!chatIds?.size) return

  const turn = asRecord(asRecord(params)?.turn)
  const turnId = typeof turn?.id === 'string' ? turn.id : ''
  if (turnId && ctx.lastForwardedTurn.get(threadId) === turnId) return

  for (const chatId of chatIds) ctx.stopTyping(chatId)

  const raw = await ctx.readLatestReply(threadId)
  const progress = ctx.turnProgress.get(threadId)
  ctx.turnProgress.delete(threadId)

  if (!raw) return

  const html = markdownToTelegramHtml(raw)

  if (progress) {
    await ctx.sender.editMessageText(progress.chatId, progress.messageId, html, 'HTML')
  } else {
    for (const chatId of chatIds) {
      await ctx.sender.sendMessage(chatId, html, { parse_mode: 'HTML' })
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

export async function handleNotification(
  n: { readonly method: string; readonly params: unknown },
  ctx: NotificationContext,
): Promise<void> {
  const threadId = extractThreadId(n)
  switch (n.method) {
    case 'item/started':
      await onItemStarted(threadId, n.params, ctx)
      break
    case 'item/completed':
      await onItemCompleted(threadId, n.params, ctx)
      break
    case 'turn/completed':
      await onTurnCompleted(threadId, n.params, ctx)
      break
    case 'thread/tokenUsage/updated':
      await onTokenUsage(threadId, n.params, ctx)
      break
  }
}
