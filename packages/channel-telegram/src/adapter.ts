import { type CodexClient, type AppConfig, addUser, revokeToken, listUsers, loadConfig } from '@codex-app/core'
import type { TokenGuard } from '@codex-app/core'
import type { TelegramUpdate, ReasoningEffort } from '@/types'
import { REASONING_EFFORTS, BOT_COMMANDS } from '@/types'
import { TelegramSender, EDIT_INTERVAL_MS } from '@/sender'
import { findBinding, saveBinding } from '@/channelStore'
import {
  listThreads, sendThreadPicker, sendModelPicker,
  sendReasoningPicker, extractLatestAssistantText,
} from '@/pickers'

type Notification = { readonly method: string; readonly params: unknown }

type StreamState = {
  readonly chatId: number
  readonly messageId: number
  readonly buffer: string
  readonly lastEditAt: number
  readonly timer: ReturnType<typeof setTimeout> | null
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function extractThreadId(n: Notification): string {
  const p = asRecord(n.params)
  if (!p) return ''
  if (typeof p.threadId === 'string') return p.threadId
  const turn = asRecord(p.turn)
  return typeof turn?.threadId === 'string' ? turn.threadId : ''
}

export class TelegramAdapter {
  private readonly chatToThread = new Map<number, string>()
  private readonly threadToChats = new Map<string, Set<number>>()
  private readonly awaitingToken = new Set<number>()
  private readonly typingTimers = new Map<number, ReturnType<typeof setInterval>>()
  private readonly modelByChat = new Map<number, string>()
  private readonly reasoningByChat = new Map<number, ReasoningEffort | ''>()
  private readonly streamByThread = new Map<string, StreamState>()
  private unsubscribe: (() => void) | null = null

  defaultCwd = process.cwd()

  private config: AppConfig

  constructor(
    private readonly codex: CodexClient,
    private readonly sender: TelegramSender,
    private readonly tokenGuard: TokenGuard,
    config: AppConfig,
  ) {
    this.config = config
  }

  start(): void {
    this.unsubscribe?.()
    this.unsubscribe = this.codex.onNotification(n => {
      void this.onNotification(n).catch(() => {})
    })
    void this.sender.setMyCommands([...BOT_COMMANDS]).catch(() => {})
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.clearAllTypingTimers()
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) { await this.handleCallback(update.callback_query); return }
    const msg = update.message
    const chatId = msg?.chat?.id
    if (typeof chatId !== 'number') return
    const text = msg?.text?.trim() ?? ''
    const photo = msg?.photo
    if (!text && !photo?.length) return
    await this.dispatch(chatId, text, photo)
  }

  private async dispatch(
    chatId: number, text: string, photo: TelegramUpdate['message']['photo'],
  ): Promise<void> {
    if (this.awaitingToken.has(chatId)) { await this.handleTokenInput(chatId, text); return }
    const bound = findBinding('telegram', String(chatId))
    if (!bound) {
      // Single user: auto-bind without asking
      if (this.config.users.length === 1) {
        saveBinding({ type: 'telegram', externalId: String(chatId), userId: this.config.users[0].id })
        await this.sender.sendMessage(chatId, `已自动绑定用户 ${this.config.users[0].name}，发送 /help 查看可用命令。`)
        return
      }
      this.awaitingToken.add(chatId)
      await this.sender.sendMessage(chatId, '欢迎！请发送你的 token 完成绑定。')
      return
    }
    if (text === '/start' || text === '/help') { await this.sendHelp(chatId); return }
    if (text === '/new' || text === '/newthread') { await this.newThread(chatId); return }
    if (text === '/session') { await sendThreadPicker(chatId, this.codex, this.sender); return }
    if (text === '/status') { await this.sendStatus(chatId); return }
    if (text === '/model') { await sendModelPicker(chatId, this.codex, this.sender); return }
    if (text === '/reasoning') { await sendReasoningPicker(chatId, this.sender); return }
    if (text.startsWith('/token')) { await this.handleTokenCommand(chatId, text, bound.userId); return }
    const projectMatch = text.match(/^\/project\s+(\S+)$/)
    if (projectMatch) {
      this.defaultCwd = projectMatch[1]!
      await this.sender.sendMessage(chatId, `项目目录已设为：${this.defaultCwd}`)
      return
    }
    const threadId = await this.ensureThread(chatId)
    try {
      this.beginTyping(chatId)
      await this.sendTurn(threadId, text, photo, chatId)
    } catch (err) {
      this.stopTyping(chatId)
      await this.sender.sendMessage(chatId, `错误：${err instanceof Error ? err.message : '发送失败'}`)
    }
  }

  private async handleTokenInput(chatId: number, token: string): Promise<void> {
    this.awaitingToken.delete(chatId)
    const userId = this.tokenGuard.resolveUserId(token.trim())
    if (!userId) {
      await this.sender.sendMessage(chatId, 'Token 无效，请重新发送消息再试。')
      return
    }
    saveBinding({ type: 'telegram', externalId: String(chatId), userId })
    await this.sender.sendMessage(chatId, '绑定成功！发送 /help 查看可用命令。')
  }

  private async handleCallback(cb: NonNullable<TelegramUpdate['callback_query']>): Promise<void> {
    const cbId = typeof cb.id === 'string' ? cb.id : ''
    const data = typeof cb.data === 'string' ? cb.data : ''
    const chatId = cb.message?.chat?.id
    if (!cbId || typeof chatId !== 'number') return

    if (data.startsWith('session:')) {
      const threadId = data.slice('session:'.length).trim()
      if (!threadId) { await this.sender.answerCallbackQuery(cbId, '无效'); return }
      this.bindThread(chatId, threadId)
      await this.sender.answerCallbackQuery(cbId, '已连接会话')
      const cwd = await this.readCwd(threadId)
      await this.sender.sendMessage(chatId, `已连接：${threadId}${cwd ? `\n目录：${cwd}` : ''}`)
      return
    }
    if (data.startsWith('ws:')) {
      const ws = data.slice('ws:'.length).trim()
      const threads = await listThreads(this.codex)
      const sub = threads.filter(t => t.workspace === ws)
      if (!sub.length) { await this.sender.answerCallbackQuery(cbId, '无会话'); return }
      const rows = [
        [{ text: '← 返回', callback_data: 'back:session' }],
        ...sub.map(t => [{ text: t.title.slice(0, 60), callback_data: `session:${t.id}` }]),
      ]
      await this.sender.answerCallbackQuery(cbId)
      await this.sender.sendMessage(chatId, '选择会话：', { inline_keyboard: rows })
      return
    }
    if (data === 'back:session') {
      await this.sender.answerCallbackQuery(cbId)
      await sendThreadPicker(chatId, this.codex, this.sender)
      return
    }
    if (data.startsWith('model:')) {
      const model = data.slice('model:'.length).trim()
      this.modelByChat.set(chatId, model)
      await this.sender.answerCallbackQuery(cbId, '模型已更新')
      await this.sender.sendMessage(chatId, `当前模型：${model}`)
      return
    }
    if (data.startsWith('reasoning:')) {
      const effort = data.slice('reasoning:'.length).trim()
      if (REASONING_EFFORTS.includes(effort as ReasoningEffort)) {
        this.reasoningByChat.set(chatId, effort as ReasoningEffort)
        await this.sender.answerCallbackQuery(cbId, '推理深度已更新')
        await this.sender.sendMessage(chatId, `推理深度：${effort}`)
      } else {
        await this.sender.answerCallbackQuery(cbId, '无效')
      }
      return
    }
    if (data.startsWith('ctx:')) {
      await this.handleContextAction(chatId, cbId, data.slice('ctx:'.length))
      return
    }
    await this.sender.answerCallbackQuery(cbId, '未知操作')
  }

  private async handleContextAction(chatId: number, cbId: string, action: string): Promise<void> {
    const threadId = this.chatToThread.get(chatId)
    if (!threadId) { await this.sender.answerCallbackQuery(cbId, '未绑定会话'); return }
    if (action === 'compact') {
      await this.codex.call('thread/compact/start', { threadId })
      await this.sender.answerCallbackQuery(cbId, '正在压缩...')
    } else if (action === 'new') {
      await this.newThread(chatId)
      await this.sender.answerCallbackQuery(cbId, '已创建新会话')
    } else {
      await this.sender.answerCallbackQuery(cbId, '已忽略')
    }
  }

  private async onNotification(n: Notification): Promise<void> {
    const threadId = extractThreadId(n)
    switch (n.method) {
      case 'turn/started': await this.onTurnStarted(threadId); break
      case 'item/agentMessage/delta': await this.onDelta(threadId, n.params); break
      case 'turn/completed': await this.onTurnCompleted(threadId); break
      case 'thread/tokenUsage/updated': await this.onTokenUsage(threadId, n.params); break
    }
  }

  private async onTurnStarted(threadId: string): Promise<void> {
    if (!threadId) return
    const chatIds = this.threadToChats.get(threadId)
    if (!chatIds?.size) return
    for (const chatId of chatIds) {
      this.stopTyping(chatId)
      const msgId = await this.sender.sendMessage(chatId, '...')
      if (msgId) {
        this.streamByThread.set(threadId, { chatId, messageId: msgId, buffer: '', lastEditAt: 0, timer: null })
      }
    }
  }

  private async onDelta(threadId: string, params: unknown): Promise<void> {
    if (!threadId) return
    const state = this.streamByThread.get(threadId)
    if (!state) return
    const p = asRecord(params)
    const delta = typeof p?.delta === 'string' ? p.delta : (typeof asRecord(p?.item)?.delta === 'string' ? String(asRecord(p?.item)!.delta) : '')
    if (!delta) return
    const buffer = state.buffer + delta
    const now = Date.now()
    if (state.timer) clearTimeout(state.timer)
    if (now - state.lastEditAt >= EDIT_INTERVAL_MS) {
      await this.sender.editMessageText(state.chatId, state.messageId, buffer)
      this.streamByThread.set(threadId, { ...state, buffer, lastEditAt: now, timer: null })
    } else {
      const timer = setTimeout(() => {
        const s = this.streamByThread.get(threadId)
        if (s) void this.sender.editMessageText(s.chatId, s.messageId, s.buffer).catch(() => {})
      }, EDIT_INTERVAL_MS)
      this.streamByThread.set(threadId, { ...state, buffer, timer })
    }
  }

  private async onTurnCompleted(threadId: string): Promise<void> {
    if (!threadId) return
    const chatIds = this.threadToChats.get(threadId)
    if (!chatIds?.size) return
    const state = this.streamByThread.get(threadId)
    if (state) {
      if (state.timer) clearTimeout(state.timer)
      const text = state.buffer || await this.readLatestReply(threadId)
      if (text) await this.sender.editMessageText(state.chatId, state.messageId, text)
      this.streamByThread.delete(threadId)
      return
    }
    const text = await this.readLatestReply(threadId)
    if (!text) return
    for (const chatId of chatIds) {
      this.stopTyping(chatId)
      await this.sender.sendMessage(chatId, text)
    }
  }

  private async onTokenUsage(threadId: string, params: unknown): Promise<void> {
    if (!threadId) return
    const usage = asRecord(asRecord(params)?.tokenUsage)
    const used = typeof usage?.used === 'number' ? usage.used : 0
    const total = typeof usage?.total === 'number' ? usage.total : 0
    if (!total || used / total < 0.8) return
    const pct = Math.round((used / total) * 100)
    const chatIds = this.threadToChats.get(threadId)
    if (!chatIds?.size) return
    const keyboard = { inline_keyboard: [[
      { text: '压缩继续', callback_data: 'ctx:compact' },
      { text: '开新会话', callback_data: 'ctx:new' },
      { text: '先不管', callback_data: 'ctx:ignore' },
    ]]}
    for (const chatId of chatIds) {
      await this.sender.sendMessage(chatId, `会话上下文使用率 ${pct}%，建议处理：`, keyboard)
    }
  }

  private bindThread(chatId: number, threadId: string): void {
    const prev = this.chatToThread.get(chatId)
    if (prev && prev !== threadId) {
      const set = this.threadToChats.get(prev)
      set?.delete(chatId)
      if (set?.size === 0) this.threadToChats.delete(prev)
    }
    this.chatToThread.set(chatId, threadId)
    const chats = this.threadToChats.get(threadId) ?? new Set<number>()
    chats.add(chatId)
    this.threadToChats.set(threadId, chats)
  }

  private async newThread(chatId: number): Promise<string> {
    const params: Record<string, unknown> = { cwd: this.defaultCwd }
    const model = this.modelByChat.get(chatId)
    if (model) params.model = model
    const res = asRecord(await this.codex.call('thread/start', params))
    const thread = asRecord(res?.thread)
    const threadId = typeof res?.threadId === 'string' ? res.threadId
      : typeof thread?.id === 'string' ? thread.id : ''
    if (!threadId) throw new Error('thread/start did not return a thread id')
    this.bindThread(chatId, threadId)
    await this.sender.sendMessage(chatId, `已新建会话：${threadId}`)
    return threadId
  }

  private async ensureThread(chatId: number): Promise<string> {
    return this.chatToThread.get(chatId) ?? this.newThread(chatId)
  }

  private async sendTurn(
    threadId: string, text: string,
    photo: TelegramUpdate['message']['photo'], chatId: number,
  ): Promise<void> {
    const input: Array<Record<string, unknown>> = []
    if (text) input.push({ type: 'text', text })
    if (photo?.length) {
      const best = [...photo].sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
        .find(p => (p.width ?? 0) >= 400) ?? photo[photo.length - 1]
      if (best?.file_id) {
        const url = await this.sender.downloadPhoto(best.file_id)
        input.push({ type: 'image', url, image_url: url })
      }
    }
    if (!input.length) input.push({ type: 'text', text: '[空消息]' })
    const params: Record<string, unknown> = { threadId, input }
    const model = this.modelByChat.get(chatId)
    const reasoning = this.reasoningByChat.get(chatId)
    if (model) params.model = model
    if (reasoning) params.effort = reasoning
    await this.codex.call('turn/start', params)
  }

  private async readLatestReply(threadId: string): Promise<string> {
    for (let i = 0; i < 5; i++) {
      if (i > 0) await new Promise<void>(r => setTimeout(r, 300))
      const res = await this.codex.call('thread/read', { threadId, includeTurns: true })
      const text = extractLatestAssistantText(res)
      if (text) return text
    }
    return ''
  }

  private async readCwd(threadId: string): Promise<string> {
    try {
      const res = asRecord(await this.codex.call('thread/read', { threadId, includeTurns: false }))
      const thread = asRecord(res?.thread)
      return typeof thread?.cwd === 'string' ? thread.cwd : ''
    } catch { return '' }
  }

  private async sendStatus(chatId: number): Promise<void> {
    const lines = ['状态：']
    const threadId = this.chatToThread.get(chatId)
    if (threadId) {
      const cwd = await this.readCwd(threadId)
      lines.push(`会话：${threadId}`, `目录：${cwd || '（未设置）'}`)
    } else {
      lines.push('会话：（未绑定）')
    }
    const model = this.modelByChat.get(chatId)
    if (model) lines.push(`模型：${model}`)
    const reasoning = this.reasoningByChat.get(chatId)
    if (reasoning) lines.push(`推理深度：${reasoning}`)
    await this.sender.sendMessage(chatId, lines.join('\n'))
  }

  private isAdmin(userId: string): boolean {
    return this.config.users.length > 0 && this.config.users[0].id === userId
  }

  private async handleTokenCommand(chatId: number, text: string, userId: string): Promise<void> {
    if (!this.isAdmin(userId)) {
      await this.sender.sendMessage(chatId, '仅管理员可执行 /token 命令。')
      return
    }

    const parts = text.split(/\s+/)
    const sub = parts[1] ?? ''

    if (sub === 'create') {
      const name = parts.slice(2).join(' ').trim() || `user-${Date.now().toString(36)}`
      const result = addUser(this.config, name)
      this.config = result.config
      await this.sender.sendMessage(chatId, [
        `✅ 用户已创建`,
        `名称: ${name}`,
        `Token: \`${result.token}\``,
        '',
        '将此 token 发送给对方即可绑定。',
      ].join('\n'), { parse_mode: 'Markdown' })
      return
    }

    if (sub === 'list') {
      const fresh = loadConfig()
      const entries = listUsers(fresh)
      if (entries.length === 0) { await this.sender.sendMessage(chatId, '暂无用户。'); return }
      const lines = entries.map(e => {
        const tokens = e.tokens.map(t => `  - ${t.token.slice(0, 8)}... (${t.label ?? ''})`).join('\n')
        return `👤 ${e.user.name} (${e.user.id})\n${tokens || '  (无 token)'}`
      })
      await this.sender.sendMessage(chatId, lines.join('\n\n'))
      return
    }

    if (sub === 'revoke') {
      const token = parts[2]?.trim()
      if (!token) { await this.sender.sendMessage(chatId, '用法: /token revoke <token>'); return }
      const result = revokeToken(this.config, token)
      if (!result) { await this.sender.sendMessage(chatId, 'Token 不存在。'); return }
      this.config = result
      await this.sender.sendMessage(chatId, `✅ Token ${token.slice(0, 8)}... 已吊销。`)
      return
    }

    // /token (no subcommand) — show current user's tokens
    const fresh = loadConfig()
    const myTokens = fresh.tokens.filter(t => t.userId === userId)
    if (myTokens.length === 0) {
      await this.sender.sendMessage(chatId, '当前无 token。')
    } else {
      const lines = myTokens.map(t => `\`${t.token}\` (${t.label ?? ''})`)
      await this.sender.sendMessage(chatId, `你的 Token:\n${lines.join('\n')}`, { parse_mode: 'Markdown' })
    }
  }

  private async sendHelp(chatId: number): Promise<void> {
    await this.sender.sendMessage(chatId, [
      '/new - 新建会话',
      '/session - 选择会话',
      '/project <path> - 设置项目目录',
      '/model - 选择模型',
      '/reasoning - 选择推理深度',
      '/status - 查看状态',
      '/token - 管理 Token（管理员）',
      '/help - 查看命令说明',
    ].join('\n'))
  }

  private beginTyping(chatId: number): void {
    this.stopTyping(chatId)
    void this.sender.sendChatAction(chatId).catch(() => {})
    const timer = setInterval(() => void this.sender.sendChatAction(chatId).catch(() => {}), 4000)
    this.typingTimers.set(chatId, timer)
  }

  private stopTyping(chatId: number): void {
    const timer = this.typingTimers.get(chatId)
    if (!timer) return
    clearInterval(timer)
    this.typingTimers.delete(chatId)
  }

  private clearAllTypingTimers(): void {
    for (const timer of this.typingTimers.values()) clearInterval(timer)
    this.typingTimers.clear()
  }
}
