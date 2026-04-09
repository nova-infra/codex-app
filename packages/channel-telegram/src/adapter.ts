import { type CodexClient, type AppConfig, saveBinding, findBinding, loadAllBindings, updateBinding } from '@codex-app/core'
import type { TokenGuard } from '@codex-app/core'
import type { TelegramUpdate, ReasoningEffort } from '@/types'
import { BOT_COMMANDS } from '@/types'
import { TelegramSender } from '@/sender'
import {
  listThreads, sendThreadPicker, sendModelPicker,
  sendReasoningPicker, extractLatestAssistantText,
} from '@/pickers'
import { handleNotification, type NotificationContext, type TurnProgress, type StreamingState } from '@/notifications'
import {
  sendHelp, sendStatus, handleTokenCommand,
  handleModelCallback, handleReasoningCallback, handleContextCallback,
  type CommandContext,
} from '@/commands'
import { sendCxReply } from '@/account-commands'
import type { AccountManager } from '@codex-app/codex-account'
import { handleCxCommand, handleCxCallback } from '@codex-app/codex-account'

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

export class TelegramAdapter {
  private readonly chatToThread = new Map<number, string>()
  private readonly threadToChats = new Map<string, Set<number>>()
  private readonly awaitingToken = new Set<number>()
  private readonly typingTimers = new Map<number, ReturnType<typeof setInterval>>()
  private readonly modelByChat = new Map<number, string>()
  private readonly reasoningByChat = new Map<number, ReasoningEffort | ''>()
  private readonly lastForwardedTurn = new Map<string, string>()
  private readonly turnProgress = new Map<string, TurnProgress>()
  private readonly streaming = new Map<string, StreamingState>()
  private readonly resumedThreads = new Set<string>()
  private unsubscribe: (() => void) | null = null

  private config: AppConfig

  constructor(
    private readonly codex: CodexClient,
    private readonly sender: TelegramSender,
    private readonly tokenGuard: TokenGuard,
    config: AppConfig,
    private readonly accountManager: AccountManager | null = null,
  ) {
    this.config = config
  }

  // ---------------------------------------------------------------------------
  // Context builders — called on demand to avoid stale captures
  // ---------------------------------------------------------------------------

  private cmdCtx(): CommandContext {
    return {
      sender: this.sender,
      codex: this.codex,
      accountManager: this.accountManager,
      chatToThread: this.chatToThread,
      modelByChat: this.modelByChat,
      reasoningByChat: this.reasoningByChat,
      config: this.config,
      getCwd: threadId => this.readCwd(threadId),
      newThread: chatId => this.newThread(chatId),
      onConfigUpdate: cfg => { this.config = cfg },
    }
  }

  private notifCtx(): NotificationContext {
    return {
      sender: this.sender,
      codex: this.codex,
      threadToChats: this.threadToChats,
      turnProgress: this.turnProgress,
      lastForwardedTurn: this.lastForwardedTurn,
      streaming: this.streaming,
      stopTyping: chatId => this.stopTyping(chatId),
      readLatestReply: threadId => this.readLatestReply(threadId),
      streamingConfig: this.config.streaming,
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start(): void {
    void this.restoreThreadMappings().catch(() => {})
    this.unsubscribe?.()
    this.unsubscribe = this.codex.onNotification(n => {
      void handleNotification(n, this.notifCtx()).catch(err => {
        console.error(`[telegram] notification error:`, err)
      })
    })
    void this.sender.setMyCommands([...BOT_COMMANDS]).catch(() => {})
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.clearAllTypingTimers()
  }

  // ---------------------------------------------------------------------------
  // Update entry-point
  // ---------------------------------------------------------------------------

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) { await this.handleCallback(update.callback_query); return }
    const msg = update.message
    const chatId = msg?.chat?.id
    if (typeof chatId !== 'number') return
    const text = msg?.text?.trim() ?? ''
    const photo = msg?.photo
    if (!text && !photo?.length) return
    console.log(`[telegram] ${new Date().toISOString()} Message from ${chatId}: ${text.slice(0, 50)}`)
    await this.dispatch(chatId, text, photo)
  }

  // ---------------------------------------------------------------------------
  // Dispatch
  // ---------------------------------------------------------------------------

  private async dispatch(
    chatId: number, text: string, photo: TelegramUpdate['message']['photo'],
  ): Promise<void> {
    if (this.awaitingToken.has(chatId)) { await this.handleTokenInput(chatId, text); return }
    const bound = await findBinding('telegram', String(chatId))
    if (!bound) {
      if (this.config.users.length === 1) {
        await saveBinding({ type: 'telegram', externalId: String(chatId), userId: this.config.users[0].id, updatedAt: new Date().toISOString() })
        await this.sender.sendMessage(chatId, `已自动绑定用户 ${this.config.users[0].name}，发送 /help 查看可用命令。`)
        return
      }
      this.awaitingToken.add(chatId)
      await this.sender.sendMessage(chatId, '欢迎！请发送你的 token 完成绑定。')
      return
    }
    if (text === '/start' || text === '/help') { await sendHelp(chatId, this.sender); return }
    if (text === '/new' || text === '/newthread') { await this.newThread(chatId); return }
    if (text === '/session') { await sendThreadPicker(chatId, this.codex, this.sender); return }
    if (text === '/status') { await sendStatus(chatId, this.cmdCtx()); return }
    if (text === '/model') { await sendModelPicker(chatId, this.codex, this.sender); return }
    if (text === '/reasoning') { await sendReasoningPicker(chatId, this.sender); return }
    if (text.startsWith('/token')) { await handleTokenCommand(chatId, text, bound.userId, this.cmdCtx()); return }
    if (text === '/cx' || text.startsWith('/cx ') || text.startsWith('/cx_')) {
      await this.handleCxText(chatId, text)
      return
    }
    const projectMatch = text.match(/^\/project\s+(\S+)$/)
    if (projectMatch) {
      const path = projectMatch[1]!
      await updateBinding('telegram', String(chatId), { cwd: path })
      await this.sender.sendMessage(chatId, `项目目录已设为：${path}`)
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
    await saveBinding({ type: 'telegram', externalId: String(chatId), userId, updatedAt: new Date().toISOString() })
    await this.sender.sendMessage(chatId, '绑定成功！发送 /help 查看可用命令。')
  }

  private async handleCxText(chatId: number, text: string): Promise<void> {
    if (!this.accountManager) {
      await this.sender.sendMessage(chatId, 'Codex 账号管理未启用。')
      return
    }
    // Normalise /cx_login → /cx login etc.
    const normalised = text.replace(/^\/cx_/, '/cx ')
    const reply = await handleCxCommand(normalised, this.accountManager)
    if (!reply) return
    await sendCxReply(this.sender, chatId, reply)
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
      await handleModelCallback(chatId, cbId, data.slice('model:'.length).trim(), this.cmdCtx())
      return
    }
    if (data.startsWith('reasoning:')) {
      await handleReasoningCallback(chatId, cbId, data.slice('reasoning:'.length).trim(), this.cmdCtx())
      return
    }
    if (data.startsWith('ctx:')) {
      await handleContextCallback(chatId, cbId, data.slice('ctx:'.length), this.cmdCtx())
      return
    }
    if (data.startsWith('cx:') && this.accountManager) {
      const reply = await handleCxCallback(data, this.accountManager)
      if (reply) {
        await this.sender.answerCallbackQuery(cbId)
        await sendCxReply(this.sender, chatId, reply)
        return
      }
    }
    await this.sender.answerCallbackQuery(cbId, '未知操作')
  }

  // ---------------------------------------------------------------------------
  // Thread management
  // ---------------------------------------------------------------------------

  private async resolveCwd(chatId: number): Promise<string> {
    const b = await findBinding('telegram', String(chatId)) as { cwd?: string } | null
    return b?.cwd ?? process.cwd()
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
    void updateBinding('telegram', String(chatId), { threadId }).catch(() => {})
  }

  private async newThread(chatId: number): Promise<string> {
    const params: Record<string, unknown> = { cwd: await this.resolveCwd(chatId) }
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
    const existing = this.chatToThread.get(chatId)
    if (!existing) return this.newThread(chatId)

    if (!this.resumedThreads.has(existing)) {
      try {
        await this.codex.call('thread/resume', { threadId: existing, cwd: await this.resolveCwd(chatId) })
        this.resumedThreads.add(existing)
      } catch {
        console.log(`[telegram] Thread ${existing.slice(0, 8)} not found, creating new`)
        return this.newThread(chatId)
      }
    }
    return existing
  }

  private async restoreThreadMappings(): Promise<void> {
    const saved = await loadAllBindings('telegram')
    let count = 0
    for (const b of saved) {
      if (!b.threadId) continue
      const chatId = Number(b.externalId)
      this.chatToThread.set(chatId, b.threadId)
      const chats = this.threadToChats.get(b.threadId) ?? new Set<number>()
      chats.add(chatId)
      this.threadToChats.set(b.threadId, chats)
      count++
    }
    if (count > 0) console.log(`[telegram] Restored ${count} thread mapping(s)`)
  }

  // ---------------------------------------------------------------------------
  // Codex I/O helpers
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Typing indicators
  // ---------------------------------------------------------------------------

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
