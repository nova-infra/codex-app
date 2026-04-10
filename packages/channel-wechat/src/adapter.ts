/**
 * WX ↔ codex JSON-RPC adapter.
 * Handles: message routing, slash commands, approval menus, token binding, notification dispatch.
 */

import type { CodexClient } from '@codex-app/core'
import type { AppConfig } from '@codex-app/core'
import type { ILinkIncomingMessage, ILinkMessageItem } from '@/iLinkClient'
import { WechatSender } from '@/sender'
import { collectInboundTextForCodex, hasWeChatRichMediaForCommands } from '@/textFormat'
import { buildCodexTurnInputFromWeChatItems } from '@/turnInput'
import { findBinding, loadAllBindings, saveBinding, updateBinding } from '@codex-app/core'
import type { PollerStatus } from '@/polling'
import { extractWechatErrorMessage, formatWechatItemProgress } from '@/progressText'
import { handleCxText, handleModelCommand, handleReasoningCommand, sendHelp, sendStatus, sendThreadPicker } from '@/commands'
import type { AccountManager } from '@codex-app/codex-account'

const DEFAULT_CDN_BASE = 'https://novac2c.cdn.weixin.qq.com/c2c'

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>) : null
}

function extractTextFromContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    const b = asRecord(block)
    if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) parts.push(b.text.trim())
  }
  return parts.join('\n')
}

function extractLatestAssistant(payload: unknown): { text: string; signature: string } {
  const response = asRecord(payload)
  const thread = asRecord(response?.thread)
  const turns = Array.isArray(thread?.turns) ? thread.turns : []
  for (let ti = turns.length - 1; ti >= 0; ti -= 1) {
    const turn = asRecord(turns[ti])
    const turnId = typeof turn?.id === 'string' ? turn.id.trim() : ''
    const items = Array.isArray(turn?.items) ? turn.items : []
    for (let ii = items.length - 1; ii >= 0; ii -= 1) {
      const item = asRecord(items[ii])
      if (item?.type !== 'agentMessage') continue
      const itemId = typeof item.id === 'string' ? item.id.trim() : ''
      const text = (typeof item.text === 'string' ? item.text.trim() : '') || extractTextFromContent(item.content)
      if (!text) continue
      const signature = turnId && itemId ? `${turnId}:${itemId}` : `pos:${ti}:${ii}:${text.length}`
      return { text, signature }
    }
  }
  return { text: '', signature: '' }
}

export class WechatAdapter {
  private readonly threadIdByChatId = new Map<string, string>()
  private readonly chatIdsByThreadId = new Map<string, Set<string>>()
  private readonly contextTokenByChatId = new Map<string, string>()
  private readonly inboundDedup = new Map<string, number>()
  private readonly lastForwardedTurn = new Map<string, string>()
  private readonly lastForwardedSig = new Map<string, string>()
  private readonly progressByChatId = new Map<string, { text: string; at: number }>()
  private readonly modelByChatId = new Map<string, string>()
  private readonly reasoningByChatId = new Map<string, string>()
  private readonly pendingTokenBind = new Set<string>()
  private readonly pendingApprovals = new Map<string, { id: number; method: string }>()
  private notificationUnsub: (() => void) | null = null

  constructor(
    private readonly codex: CodexClient,
    private readonly sender: WechatSender,
    private readonly config: AppConfig,
    private readonly getPollerStatus: () => PollerStatus,
    private readonly accountManager: AccountManager | null = null,
  ) {}

  private async resolveCwd(chatId: string): Promise<string> {
    const b = await findBinding('wechat', chatId) as { cwd?: string } | null
    return b?.cwd ?? process.cwd()
  }

  start(): void {
    void this.restoreChatState().catch(() => {})
    this.notificationUnsub?.()
    this.notificationUnsub = this.codex.onNotification((n) => {
      void this.handleNotification(n).catch(() => {})
    })
  }

  stop(): void {
    this.notificationUnsub?.()
    this.notificationUnsub = null
    this.sender.clearAllTypingTimers()
  }

  async notifyChat(chatId: string, text: string): Promise<void> {
    await this.sendRaw(chatId, text)
  }

  async handleMessage(msg: ILinkIncomingMessage): Promise<void> {
    const chatId = (msg.from_user_id ?? '').trim()
    if (!chatId) return
    if (typeof msg.group_id === 'string' && msg.group_id.trim() !== '') return
    if (msg.message_type === 2) return

    const token = typeof msg.context_token === 'string' ? msg.context_token.trim() : ''
    if (token) this.contextTokenByChatId.set(chatId, token)
    if (!(this.contextTokenByChatId.get(chatId) ?? '').trim()) return

    const items: ILinkMessageItem[] = Array.isArray(msg.item_list) ? msg.item_list : []
    const text = collectInboundTextForCodex(items).trim()
    const rich = hasWeChatRichMediaForCommands(items)
    if (!text && !rich) return
    if (this.isDuplicate(msg)) return

    if (this.pendingTokenBind.has(chatId)) {
      await this.handleTokenBind(chatId, text)
      return
    }

    const userId = (await findBinding('wechat', chatId))?.userId ?? null
    if (!userId) {
      // Single user: auto-bind without asking
      if (this.config.users.length === 1) {
        await saveBinding({ type: 'wechat', externalId: chatId, userId: this.config.users[0].id, updatedAt: new Date().toISOString() })
        const name = this.config.users[0].name
        await this.sendRaw(chatId, `已自动绑定用户 ${name}，发消息开始使用 Codex。`)
        return
      }
      this.pendingTokenBind.add(chatId)
      await this.sendRaw(chatId, '欢迎使用 Codex！请发送你的 token 完成绑定：')
      return
    }

    if (!rich && text.startsWith('/')) {
      if (await this.handleSlashCommand(chatId, text.trim())) return
    }
    if (!rich && /^[12]$/.test(text.trim())) {
      if (await this.handleApprovalReply(chatId, text.trim())) return
    }

    const input = await buildCodexTurnInputFromWeChatItems(items, DEFAULT_CDN_BASE)
    if (input.length === 0) return

    const contextToken = this.contextTokenByChatId.get(chatId) ?? ''
    await this.sender.notifyTypingStart(chatId, contextToken)
    this.sender.beginTypingRefresh(chatId, contextToken)
    try {
      const threadId = await this.ensureThread(chatId)
      await this.sendProgress(chatId, '已收到，处理中…', true)
      const params: Record<string, unknown> = { threadId, input }
      const model = this.modelByChatId.get(chatId)
      const reasoning = this.reasoningByChatId.get(chatId)
      if (model) params.model = model
      if (reasoning) params.effort = reasoning
      await this.codex.call('turn/start', params)
    } catch (error) {
      this.sender.endTypingIndicator(chatId, contextToken)
      this.progressByChatId.delete(chatId)
      const errMsg = error instanceof Error ? error.message : 'Failed to forward message'
      await this.sendRaw(chatId, `发送失败: ${errMsg}`)
    }
  }

  private async handleSlashCommand(chatId: string, cmd: string): Promise<boolean> {
    if (cmd === '/start' || cmd === '/help') { await sendHelp(chatId, this.commandCtx()); return true }
    if (cmd === '/new' || cmd === '/newthread') {
      const threadId = await this.createThread(chatId)
      const cwd = await this.readThreadCwd(threadId)
      await this.sendRaw(chatId, `已新建会话：${threadId}${cwd ? `\n当前目录：${cwd}` : ''}`)
      return true
    }
    if (cmd === '/session') { await sendThreadPicker(chatId, this.commandCtx()); return true }
    if (cmd === '/status') { await sendStatus(chatId, this.commandCtx()); return true }
    if (await handleModelCommand(chatId, cmd, this.commandCtx())) return true
    if (await handleReasoningCommand(chatId, cmd, this.commandCtx())) return true
    if (await handleCxText(chatId, cmd, this.commandCtx())) return true
    const threadMatch = cmd.match(/^\/thread\s+(\S+)$/)
    if (threadMatch) {
      const threadId = threadMatch[1]
      this.bindChatToThread(chatId, threadId)
      const cwd = await this.readThreadCwd(threadId)
      await this.sendRaw(chatId, `已连接会话：${threadId}${cwd ? `\n当前目录：${cwd}` : ''}`)
      return true
    }
    const projectMatch = cmd.match(/^\/project\s+(\S+)$/)
    if (projectMatch) {
      await updateBinding('wechat', chatId, { cwd: projectMatch[1] })
      await this.sendRaw(chatId, `项目目录已设为：${projectMatch[1]}`)
      return true
    }
    return false
  }

  private async handleApprovalReply(chatId: string, choice: string): Promise<boolean> {
    const pending = this.pendingApprovals.get(chatId)
    if (!pending) return false
    this.pendingApprovals.delete(chatId)
    const approved = choice === '1'
    this.codex.reply(pending.id, { approved })
    await this.sendRaw(chatId, approved ? '已确认' : '已拒绝')
    return true
  }

  private async handleTokenBind(chatId: string, token: string): Promise<void> {
    const entry = this.config.tokens.find((t) => t.token === token.trim())
    if (!entry) { await this.sendRaw(chatId, 'Token 无效，请重新发送正确的 token：'); return }
    await saveBinding({ type: 'wechat', externalId: chatId, userId: entry.userId, updatedAt: new Date().toISOString() })
    this.pendingTokenBind.delete(chatId)
    const user = this.config.users.find((u) => u.id === entry.userId)
    await this.sendRaw(chatId, `绑定成功！欢迎 ${user?.name ?? entry.userId}，发消息开始使用 Codex。`)
  }

  private async handleNotification(notification: { method: string; params: unknown }): Promise<void> {
    const params = asRecord(notification.params)
    if (notification.method.endsWith('Approval') && params) {
      const id = typeof params.id === 'number' ? params.id : -1
      if (id < 0) return
      const desc = typeof params.description === 'string' ? params.description : notification.method
      for (const [chatId] of this.threadIdByChatId) {
        this.pendingApprovals.set(chatId, { id, method: notification.method })
        const label = notification.method.replace('Approval', '')
        await this.sendRaw(chatId, `[${label}] ${desc}\n\n回复 1 确认，2 拒绝`)
      }
      return
    }
    if (notification.method === 'item/started') {
      const threadId = this.extractThreadId(notification)
      if (!threadId) return
      const chatIds = this.chatIdsByThreadId.get(threadId)
      const text = formatWechatItemProgress(notification.params)
      if (!chatIds || !text) return
      for (const chatId of chatIds) await this.sendProgress(chatId, text)
      return
    }
    if (notification.method === 'error') {
      const threadId = this.extractThreadId(notification)
      if (!threadId) return
      const chatIds = this.chatIdsByThreadId.get(threadId)
      if (!chatIds || chatIds.size === 0) return
      const message = `处理失败：${extractWechatErrorMessage(notification.params)}`
      for (const chatId of chatIds) {
        this.progressByChatId.delete(chatId)
        this.sender.endTypingIndicator(chatId, this.contextTokenByChatId.get(chatId) ?? '')
        await this.sendRaw(chatId, message)
      }
      return
    }
    if (notification.method !== 'turn/completed') return
    const threadId = this.extractThreadId(notification)
    if (!threadId) return
    const chatIds = this.chatIdsByThreadId.get(threadId)
    if (!chatIds || chatIds.size === 0) return
    const turnId = this.extractTurnId(notification)
    if (turnId && this.lastForwardedTurn.get(threadId) === turnId) return
    const { text, signature } = await this.readLatestAssistant(threadId)
    const endTyping = (): void => {
      for (const cid of chatIds) this.sender.endTypingIndicator(cid, this.contextTokenByChatId.get(cid) ?? '')
    }
    if (!text || (signature && this.lastForwardedSig.get(threadId) === signature)) { endTyping(); return }
    for (const cid of chatIds) {
      const token = this.contextTokenByChatId.get(cid) ?? ''
      this.progressByChatId.delete(cid)
      await this.sender.sendAssistantReply(cid, token, text)
      this.sender.endTypingIndicator(cid, token)
    }
    if (turnId) this.lastForwardedTurn.set(threadId, turnId)
    if (signature) this.lastForwardedSig.set(threadId, signature)
  }

  private async readLatestAssistant(threadId: string): Promise<{ text: string; signature: string }> {
    for (let i = 0; i < 12; i += 1) {
      if (i > 0) await new Promise((r) => setTimeout(r, 280))
      const result = extractLatestAssistant(await this.codex.call('thread/read', { threadId, includeTurns: true }))
      if (result.text) return result
    }
    return { text: '', signature: '' }
  }

  private async ensureThread(chatId: string): Promise<string> {
    return this.threadIdByChatId.get(chatId) ?? this.createThread(chatId)
  }

  private async createThread(chatId: string): Promise<string> {
    const params: Record<string, unknown> = { cwd: await this.resolveCwd(chatId) }
    const model = this.modelByChatId.get(chatId)
    if (model) params.model = model
    const response = asRecord(await this.codex.call('thread/start', params))
    const thread = asRecord(response?.thread)
    const threadId = typeof thread?.id === 'string' ? thread.id : ''
    if (!threadId) throw new Error('thread/start did not return thread id')
    this.bindChatToThread(chatId, threadId)
    return threadId
  }

  private bindChatToThread(chatId: string, threadId: string): void {
    const prev = this.threadIdByChatId.get(chatId)
    if (prev && prev !== threadId) {
      const prevSet = this.chatIdsByThreadId.get(prev)
      prevSet?.delete(chatId)
      if (prevSet?.size === 0) this.chatIdsByThreadId.delete(prev)
    }
    this.threadIdByChatId.set(chatId, threadId)
    const ids = this.chatIdsByThreadId.get(threadId) ?? new Set<string>()
    ids.add(chatId)
    this.chatIdsByThreadId.set(threadId, ids)
    void updateBinding('wechat', chatId, { threadId }).catch(() => {})
  }

  private async readThreadCwd(threadId: string): Promise<string> {
    try {
      const r = asRecord(await this.codex.call('thread/read', { threadId, includeTurns: false }))
      const t = asRecord(r?.thread)
      return typeof t?.cwd === 'string' ? t.cwd.trim() : ''
    } catch { return '' }
  }

  private async sendRaw(chatId: string, text: string): Promise<void> {
    const token = this.contextTokenByChatId.get(chatId) ?? ''
    if (!token) return
    try { await this.sender.sendText(chatId, token, text) } catch { /* best-effort */ }
  }

  private async sendProgress(chatId: string, text: string, force = false): Promise<void> {
    const token = this.contextTokenByChatId.get(chatId) ?? ''
    if (!token) return
    const now = Date.now()
    const prev = this.progressByChatId.get(chatId)
    if (!force) {
      if (prev?.text === text) return
      if (prev && now - prev.at < 2500) return
    }
    this.progressByChatId.set(chatId, { text, at: now })
    await this.sender.sendProgress(chatId, token, text)
  }

  private commandCtx() {
    return {
      codex: this.codex,
      accountManager: this.accountManager,
      getPollerStatus: this.getPollerStatus,
      sendRaw: (chatId: string, text: string) => this.sendRaw(chatId, text),
      getThreadId: (chatId: string) => this.threadIdByChatId.get(chatId),
      getModel: (chatId: string) => this.modelByChatId.get(chatId),
      getReasoning: (chatId: string) => this.reasoningByChatId.get(chatId),
      readThreadCwd: (threadId: string) => this.readThreadCwd(threadId),
      setModel: async (chatId: string, model: string) => {
        this.modelByChatId.set(chatId, model)
        await updateBinding('wechat', chatId, { model })
      },
      setReasoning: async (chatId: string, effort: string) => {
        this.reasoningByChatId.set(chatId, effort)
        await updateBinding('wechat', chatId, { reasoning: effort })
      },
    }
  }

  private async restoreChatState(): Promise<void> {
    const bindings = await loadAllBindings('wechat')
    for (const binding of bindings) {
      const chatId = binding.externalId
      if (binding.model) this.modelByChatId.set(chatId, binding.model)
      if (binding.reasoning) this.reasoningByChatId.set(chatId, binding.reasoning)
      if (binding.threadId) this.bindChatToThread(chatId, binding.threadId)
    }
  }

  private extractThreadId(n: { params: unknown }): string {
    const p = asRecord(n.params)
    if (!p) return ''
    if (typeof p.threadId === 'string') return p.threadId
    return typeof asRecord(p.turn)?.threadId === 'string' ? (asRecord(p.turn)?.threadId as string) : ''
  }

  private extractTurnId(n: { params: unknown }): string {
    const p = asRecord(n.params)
    if (!p) return ''
    if (typeof p.turnId === 'string') return p.turnId
    return typeof asRecord(p.turn)?.id === 'string' ? (asRecord(p.turn)?.id as string) : ''
  }

  private isDuplicate(msg: ILinkIncomingMessage): boolean {
    const chatId = (msg.from_user_id ?? '').trim()
    const clientId = typeof msg.client_id === 'string' ? msg.client_id.trim() : ''
    const seq = typeof msg.seq === 'number' ? msg.seq : undefined
    const messageId = typeof msg.message_id === 'number' ? msg.message_id : undefined
    let key: string | null = null
    if (clientId) key = `c:${clientId}`
    else if (seq !== undefined && chatId) key = `s:${chatId}:${seq}`
    else if (messageId !== undefined && chatId) key = `m:${chatId}:${messageId}`
    if (!key) return false
    const now = Date.now()
    for (const [k, exp] of this.inboundDedup) { if (exp < now) this.inboundDedup.delete(k) }
    const prev = this.inboundDedup.get(key)
    if (prev !== undefined && prev > now) return true
    this.inboundDedup.set(key, now + 3_600_000)
    return false
  }
}
