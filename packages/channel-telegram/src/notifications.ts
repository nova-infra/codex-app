import { formatCodexItemProgress, type CodexClient, type RuntimeEvent } from '@codex-app/core'
import type { TelegramSender } from '@/sender'
import { renderTelegramHtmlSegments, renderTelegramMarkdownSegments } from '@/format'
import { TelegramStreamConsumer, type TelegramStreamingConfig } from '@/streamConsumer'

export type TurnProgress = {
  chatId: number
  messageId: number
  steps: string[]
  lastEditAt: number
}

export type StreamingState = TelegramStreamConsumer

export type NotificationContext = {
  readonly sender: TelegramSender
  readonly codex: CodexClient
  readonly threadToChats: ReadonlyMap<string, ReadonlySet<number>>
  readonly turnProgress: Map<string, TurnProgress>
  readonly lastForwardedTurn: Map<string, string>
  readonly streaming: Map<string, StreamingState>
  readonly thinking: Map<string, { chatId: number; messageId: number; text: string; lastEditAt: number }>
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

function formatItemLabel(item: Record<string, unknown>, _mode: 'classic' | 'hermes'): string | null {
  return formatCodexItemProgress(item, 96)
}

function compactThinkingText(text: string): string {
  const cleaned = text
    .replace(/[💭🧠]/g, ' ')
    .replace(/\bThinking\.{0,3}\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.slice(0, 120)
}

function renderThinkingLine(text: string): string {
  return text ? `🧠 ${text}` : ''
}

async function upsertThinkingLine(threadId: string, delta: string, ctx: NotificationContext): Promise<void> {
  const text = compactThinkingText(delta)
  if (!threadId || !text) return
  const existing = ctx.thinking.get(threadId)
  if (existing) {
    if (!text) return
    const nextLine = renderThinkingLine(text)
    const now = Date.now()
    if (now - existing.lastEditAt > 2500 && nextLine !== existing.text) {
      await ctx.sender.editMessageText(existing.chatId, existing.messageId, nextLine)
      ctx.thinking.set(threadId, { ...existing, text: nextLine, lastEditAt: now })
      return
    }
    ctx.thinking.set(threadId, { ...existing, text: nextLine })
    return
  }
  const line = renderThinkingLine(text)
  const chatIds = ctx.threadToChats.get(threadId)
  if (!chatIds?.size) return
  const chatId = chatIds.values().next().value!
  const messageId = await ctx.sender.sendMessage(chatId, line)
  if (messageId) ctx.thinking.set(threadId, { chatId, messageId, text: line, lastEditAt: Date.now() })
}

async function closeThinkingLine(threadId: string, ctx: NotificationContext): Promise<void> {
  const state = ctx.thinking.get(threadId)
  if (!state) return
  ctx.thinking.delete(threadId)
  await ctx.sender.editMessageText(state.chatId, state.messageId, state.text).catch(() => {})
}

function collectImageUrls(value: unknown): string[] {
  if (typeof value === 'string') {
    const text = value.trim()
    return /^https?:\/\//.test(text) ? [text] : []
  }
  if (Array.isArray(value)) return value.flatMap(collectImageUrls)
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

function getStreaming(threadId: string, ctx: NotificationContext): StreamingState | null {
  return ctx.streaming.get(threadId) ?? null
}

function getOrCreateStreaming(threadId: string, ctx: NotificationContext): StreamingState | null {
  const existing = getStreaming(threadId, ctx)
  if (existing) return existing
  const chatIds = ctx.threadToChats.get(threadId)
  if (!chatIds?.size) return null
  const chatId = chatIds.values().next().value!
  const progress = ctx.turnProgress.get(threadId)
  const state = new TelegramStreamConsumer(
    ctx.sender,
    chatId,
    ctx.renderMode,
    ctx.streamingConfig,
    progress?.messageId,
  )
  if (progress) ctx.turnProgress.delete(threadId)
  ctx.streaming.set(threadId, state)
  return state
}

async function maybeSendImage(threadId: string, params: unknown, ctx: NotificationContext): Promise<void> {
  const chatIds = ctx.threadToChats.get(threadId)
  if (!threadId || !chatIds?.size) return
  const item = asRecord(asRecord(params)?.item)
  if (!item) return
  const type = typeof item.type === 'string' ? item.type : ''
  if (type !== 'imageGeneration' && type !== 'imageView') return
  const urls = [...new Set(collectImageUrls(item))]
  for (const chatId of chatIds) {
    for (const url of urls.slice(0, 4)) {
      await ctx.sender.sendPhoto(chatId, url)
    }
  }
}

async function updateProgressCard(threadId: string, label: string, ctx: NotificationContext): Promise<void> {
  const text = label.replace(/\s+/g, ' ').trim().slice(0, 140)
  if (!threadId || !text) return
  const progress = ctx.turnProgress.get(threadId)
  if (progress) {
    const now = Date.now()
    const prev = progress.steps[0] ?? ''
    if (prev === text) return
    if (now - progress.lastEditAt > 1200) {
      await ctx.sender.editMessageText(progress.chatId, progress.messageId, text)
      ctx.turnProgress.set(threadId, { ...progress, steps: [text], lastEditAt: now })
      return
    }
    ctx.turnProgress.set(threadId, { ...progress, steps: [text] })
    return
  }
  const chatIds = ctx.threadToChats.get(threadId)
  if (!chatIds?.size) return
  const chatId = chatIds.values().next().value!
  const messageId = await ctx.sender.sendMessage(chatId, text)
  if (!messageId) return
  ctx.turnProgress.set(threadId, { chatId, messageId, steps: [text], lastEditAt: Date.now() })
}

async function completeProgressCard(threadId: string, label: string, ctx: NotificationContext): Promise<void> {
  const progress = ctx.turnProgress.get(threadId)
  if (!progress) return
  const started = ctx.renderMode === 'hermes' ? `• ${label}` : `⏳ ${label}`
  const completed = ctx.renderMode === 'hermes' ? `✓ ${label}` : `✅ ${label}`
  const steps = foldProgressSteps(progress.steps.map(step => (step === started ? completed : step)))
  const now = Date.now()
  if (now - progress.lastEditAt > 800) {
    await ctx.sender.editMessageText(progress.chatId, progress.messageId, steps.join('\n'))
    ctx.turnProgress.set(threadId, { ...progress, steps, lastEditAt: now })
    return
  }
  ctx.turnProgress.set(threadId, { ...progress, steps })
}

async function onItemStarted(threadId: string, params: unknown, ctx: NotificationContext): Promise<void> {
  const item = asRecord(asRecord(params)?.item)
  const type = typeof item?.type === 'string' ? item.type : ''
  if (type === 'reasoning') return
  const label = item ? formatItemLabel(item, ctx.renderMode) : null
  if (label) await updateProgressCard(threadId, label, ctx)
}

async function onItemCompleted(threadId: string, params: unknown, ctx: NotificationContext): Promise<void> {
  // Do not emit progress cards. Keep image relay for image-capable items.
  await maybeSendImage(threadId, params, ctx)
}

function extractTextDelta(params: unknown): string {
  const p = asRecord(params)
  if (!p) return ''
  for (const key of ['delta', 'text', 'content']) {
    if (typeof p[key] === 'string') return String(p[key])
  }
  const item = asRecord(p.item)
  if (typeof item?.delta === 'string') return item.delta
  if (typeof item?.text === 'string') return item.text
  return ''
}

async function onAgentMessageDelta(threadId: string, params: unknown, ctx: NotificationContext): Promise<void> {
  // Keep Telegram ordered like WeChat: show tool/status first, then final answer.
  // Streaming assistant text can arrive before later tool events, causing text → tool disorder.
  return
}

async function onReasoningSummaryDelta(threadId: string, params: unknown, ctx: NotificationContext): Promise<void> {
  const delta = typeof asRecord(params)?.delta === 'string' ? String(asRecord(params)?.delta) : ''
  await upsertThinkingLine(threadId, delta, ctx)
}

async function finalizeTurn(threadId: string, raw: string, ctx: NotificationContext): Promise<boolean> {
  const streaming = getStreaming(threadId, ctx)
  if (!streaming) return false
  await streaming.finalize(raw)
  ctx.streaming.delete(threadId)
  if (!streaming.hasDeliveredText) return false
  ctx.turnProgress.delete(threadId)
  return true
}

async function sendFinalReply(threadId: string, raw: string, ctx: NotificationContext): Promise<void> {
  const progress = ctx.turnProgress.get(threadId)
  const chatIds = ctx.threadToChats.get(threadId)
  ctx.turnProgress.delete(threadId)
  if (!raw || !chatIds?.size) return
  const segments = ctx.renderMode === 'hermes'
    ? renderTelegramHtmlSegments(raw)
    : renderTelegramMarkdownSegments(raw)
  if (progress) {
    const chatId = progress.chatId
    for (const seg of segments) {
      if (ctx.renderMode === 'hermes') await ctx.sender.sendHtmlMessage(chatId, seg)
      else await ctx.sender.sendRichMessage(chatId, seg)
    }
    return
  }
  for (const chatId of chatIds) {
    for (const seg of segments) {
      if (ctx.renderMode === 'hermes') await ctx.sender.sendHtmlMessage(chatId, seg)
      else await ctx.sender.sendRichMessage(chatId, seg)
    }
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
  await closeThinkingLine(threadId, ctx)
  const raw = await ctx.readLatestReply(threadId)
  const delivered = await finalizeTurn(threadId, raw, ctx)
  if (!delivered) {
    await sendFinalReply(threadId, raw, ctx)
  }
  if (turnId) ctx.lastForwardedTurn.set(threadId, turnId)
}

async function onTokenUsage(threadId: string, params: unknown, ctx: NotificationContext): Promise<void> {
  const usage = asRecord(asRecord(params)?.tokenUsage)
  const used = typeof usage?.used === 'number' ? usage.used : 0
  const total = typeof usage?.total === 'number' ? usage.total : 0
  if (!threadId || !total || used / total < 0.8) return
  const chatIds = ctx.threadToChats.get(threadId)
  if (!chatIds?.size) return
  const pct = Math.round((used / total) * 100)
  const keyboard = { inline_keyboard: [[
    { text: '压缩继续', callback_data: 'ctx:compact' },
    { text: '开新会话', callback_data: 'ctx:new' },
    { text: '先不管', callback_data: 'ctx:ignore' },
  ]] }
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
  const streaming = getStreaming(threadId, ctx)
  if (streaming) ctx.streaming.delete(threadId)
  ctx.thinking.delete(threadId)
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
  const description = typeof params?.description === 'string' ? params.description.trim() : '需要确认操作'
  const label = event.method.replace('Approval', '')
  const keyboard = { inline_keyboard: [[
    { text: '确认', callback_data: `approval:${event.requestId}:approve` },
    { text: '拒绝', callback_data: `approval:${event.requestId}:reject` },
  ]] }
  for (const chatId of chatIds) {
    await ctx.sender.sendMessage(chatId, `[${label}] ${description}`, keyboard)
  }
}

export async function handleNotification(event: RuntimeEvent, ctx: NotificationContext): Promise<void> {
  const threadId = event.threadId ?? ''
  if (event.kind === 'approval_request') {
    await onApprovalRequest(event, ctx)
    return
  }
  switch (event.method) {
    case 'item/agentMessage/delta':
      await onAgentMessageDelta(threadId, event.raw.params, ctx)
      return
    case 'item/reasoning/summaryTextDelta':
      await onReasoningSummaryDelta(threadId, event.raw.params, ctx)
      return
    case 'item/started':
      await onItemStarted(threadId, event.raw.params, ctx)
      return
    case 'item/completed':
      await onItemCompleted(threadId, event.raw.params, ctx)
      return
    case 'turn/completed':
      await onTurnCompleted(threadId, event.raw.params, ctx)
      return
    case 'error':
      await onError(threadId, event.raw.params, ctx)
      return
    case 'thread/tokenUsage/updated':
      await onTokenUsage(threadId, event.raw.params, ctx)
      return
  }
}
