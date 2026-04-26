import {
  type CodexClient,
  type AppConfig,
  type EventPipeline,
  type SessionControlService,
  saveBinding,
  findBinding,
  loadAllBindings,
  updateBinding,
} from '@codex-app/core'
import type { TokenGuard } from '@codex-app/core'
import type { TelegramUpdate, ReasoningEffort } from '@/types'
import { BOT_COMMANDS } from '@/types'
import { TelegramSender } from '@/sender'
import { buildTelegramTurnText } from '@/channelText'
import {
  listThreads,
  sendThreadPicker, sendModelPicker,
  sendReasoningPicker, extractLatestAssistantText,
} from '@/pickers'
import { handleNotification, showThinking, type NotificationContext, type TurnProgress, type StreamingState } from '@/notifications'
import { buildTelegramContextSummary } from '@/contextSummary'
import {
  sendHelp, sendStatus, handleTokenCommand,
  handleModelCallback, handleReasoningCallback, handleContextCallback,
  type CommandContext,
} from '@/commands'

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
  private readonly thinking = new Map<string, { chatId: number; messageId: number; text: string; lastEditAt: number }>()
  private readonly resumedThreads = new Set<string>()
  private unsubscribe: (() => void) | null = null

  private config: AppConfig

  constructor(
    private readonly codex: CodexClient,
    private readonly sender: TelegramSender,
    private readonly tokenGuard: TokenGuard,
    private readonly sessions: SessionControlService,
    private readonly events: EventPipeline,
    config: AppConfig,
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
      sessions: this.sessions,
      chatToThread: this.chatToThread,
      modelByChat: this.modelByChat,
      reasoningByChat: this.reasoningByChat,
      config: this.config,
      getUserId: chatId => this.getBoundUserId(chatId),
      getCwd: threadId => this.readCwd(threadId),
      newThread: chatId => this.newThread(chatId),
      compactThread: chatId => this.compactThread(chatId),
      onConfigUpdate: cfg => { this.config = cfg },
      persistChatState: (chatId, patch) => updateBinding('telegram', String(chatId), patch),
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
      thinking: this.thinking,
      stopTyping: chatId => this.stopTyping(chatId),
      readLatestReply: threadId => this.readLatestReply(threadId),
      streamingConfig: this.config.streaming,
      renderMode: this.config.telegram?.renderMode ?? 'classic',
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start(): void {
    void this.restoreThreadMappings().catch(() => {})
    this.unsubscribe?.()
    this.unsubscribe = this.events.onEvent(event => {
      void handleNotification(event, this.notifCtx()).catch(err => {
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
        await this.sender.sendMessage(chatId, `已自动绑定 Agent ${this.config.users[0].name}，发送 /help 查看可用命令。`)
        return
      }
      this.awaitingToken.add(chatId)
      await this.sender.sendMessage(chatId, '欢迎！请发送你的 token 完成绑定。')
      return
    }
    if (text === '/start' || text === '/help') { await sendHelp(chatId, this.sender); return }
    if (text === '/new' || text === '/newthread') { await this.newThread(chatId); return }
    if (text === '/session') {
      await sendThreadPicker(chatId, await this.getBoundUserId(chatId), this.sessions, this.sender)
      return
    }
    if (text === '/status') { await sendStatus(chatId, this.cmdCtx()); return }
    if (text === '/model') { await sendModelPicker(chatId, this.codex, this.sender); return }
    if (text === '/reasoning') { await sendReasoningPicker(chatId, this.sender); return }
    if (text.startsWith('/token')) { await handleTokenCommand(chatId, text, bound.userId, this.cmdCtx()); return }
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
    const userId = this.tokenGuard.resolveUserId(token.trim())
    if (!userId) {
      await this.sender.sendMessage(chatId, 'Token 无效，请重新发送消息再试。')
      return
    }
    this.awaitingToken.delete(chatId)
    await saveBinding({ type: 'telegram', externalId: String(chatId), userId, updatedAt: new Date().toISOString() })
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
      await this.switchThread(chatId, threadId)
      await this.sender.answerCallbackQuery(cbId, '已连接会话')
      const cwd = await this.readCwd(threadId)
      await this.sender.sendMessage(chatId, `已连接：${threadId}${cwd ? `\n目录：${cwd}` : ''}`)
      return
    }
    if (data.startsWith('ws:')) {
      const workspaceKey = data.slice('ws:'.length).trim()
      const sub = (await listThreads(await this.getBoundUserId(chatId), this.sessions))
        .filter(t => t.workspaceKey === workspaceKey)
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
      await sendThreadPicker(chatId, await this.getBoundUserId(chatId), this.sessions, this.sender)
      return
    }
    if (data.startsWith('approval:')) {
      const matched = data.match(/^approval:(\d+):(approve|reject)$/)
      if (!matched) { await this.sender.answerCallbackQuery(cbId, '无效'); return }
      await this.sessions.replyApproval(Number(matched[1]), matched[2] === 'approve')
      await this.sender.answerCallbackQuery(cbId, matched[2] === 'approve' ? '已确认' : '已拒绝')
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
    await this.sender.answerCallbackQuery(cbId, '未知操作')
  }

  // ---------------------------------------------------------------------------
  // Thread management
  // ---------------------------------------------------------------------------

  private async resolveCwd(chatId: number): Promise<string> {
    const b = await findBinding('telegram', String(chatId)) as { cwd?: string } | null
    return b?.cwd ?? process.cwd()
  }

  private async getBoundUserId(chatId: number): Promise<string> {
    const binding = await findBinding('telegram', String(chatId))
    if (!binding?.userId) throw new Error('chat is not bound to an agent')
    return binding.userId
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
    const userId = await this.getBoundUserId(chatId)
    const cwd = await this.resolveCwd(chatId)
    const model = this.modelByChat.get(chatId)
    const threadId = await this.sessions.createChannelThread('telegram', String(chatId), userId, {
      projectDir: cwd,
      model,
    })
    this.bindThread(chatId, threadId)
    const summary = await buildTelegramContextSummary({
      chatId,
      config: this.config,
      getUserId: id => this.getBoundUserId(id),
      model,
      threadId,
      cwd,
    })
    await this.sender.sendMessage(chatId, ['已新建会话：', ...summary].join('\n'))
    return threadId
  }

  private async ensureThread(chatId: number): Promise<string> {
    const existing = this.chatToThread.get(chatId)
    if (!existing) {
      const userId = await this.getBoundUserId(chatId)
      const threadId = await this.sessions.ensureChannelThread('telegram', String(chatId), userId, {
        projectDir: await this.resolveCwd(chatId),
        model: this.modelByChat.get(chatId),
      })
      this.bindThread(chatId, threadId)
      return threadId
    }

    if (!this.resumedThreads.has(existing)) {
      try {
        await this.sessions.resumeThread(await this.getBoundUserId(chatId), existing, await this.resolveCwd(chatId))
        this.resumedThreads.add(existing)
      } catch {
        console.log(`[telegram] Thread ${existing.slice(0, 8)} not found, creating new`)
        return this.newThread(chatId)
      }
    }
    return existing
  }

  private async switchThread(chatId: number, threadId: string): Promise<void> {
    await this.sessions.switchChannelThread(
      'telegram',
      String(chatId),
      await this.getBoundUserId(chatId),
      threadId,
    )
    this.bindThread(chatId, threadId)
  }

  private async compactThread(chatId: number): Promise<void> {
    const threadId = this.chatToThread.get(chatId)
    if (!threadId) throw new Error('未绑定会话')
    await this.sessions.compactThread(await this.getBoundUserId(chatId), threadId)
  }

  private async restoreThreadMappings(): Promise<void> {
    const saved = await loadAllBindings('telegram')
    let count = 0
    for (const b of saved) {
      if (b.model) this.modelByChat.set(Number(b.externalId), b.model)
      if (b.reasoning && b.reasoning !== '') this.reasoningByChat.set(Number(b.externalId), b.reasoning as ReasoningEffort)
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
    const input: Array<Record<string, unknown>> = [
      { type: 'text', text: buildTelegramTurnText(text) },
    ]
    if (photo?.length) {
      const best = [...photo].sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
        .find(p => (p.width ?? 0) >= 400) ?? photo[photo.length - 1]
      if (best?.file_id) {
        const url = await this.sender.downloadPhoto(best.file_id)
        input.push({ type: 'image', url, image_url: url })
      }
    }
    const params: Record<string, unknown> = { threadId, input }
    const model = this.modelByChat.get(chatId)
    const reasoning = this.reasoningByChat.get(chatId)
    if (model) params.model = model
    if (reasoning) params.effort = reasoning
    await showThinking(threadId, this.notifCtx())
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
      return await this.sessions.readThreadCwdUnsafe(threadId)
    } catch {
      return ''
    }
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
