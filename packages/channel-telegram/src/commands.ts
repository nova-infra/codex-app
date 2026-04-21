/**
 * Slash command and callback handlers for the Telegram channel.
 * Stateless functions that receive a CommandContext from the adapter.
 */

import { type AppConfig, addUser, revokeToken, listUsers, loadConfig } from '@codex-app/core'
import type { CodexClient, SessionControlService } from '@codex-app/core'
import type { ReasoningEffort } from '@/types'
import { REASONING_EFFORTS } from '@/types'
import type { TelegramSender } from '@/sender'

export type CommandContext = {
  readonly sender: TelegramSender
  readonly codex: CodexClient
  readonly sessions: SessionControlService
  readonly chatToThread: ReadonlyMap<number, string>
  readonly modelByChat: Map<number, string>
  readonly reasoningByChat: Map<number, ReasoningEffort | ''>
  readonly config: AppConfig
  readonly getUserId: (chatId: number) => Promise<string>
  readonly getCwd: (threadId: string) => Promise<string>
  readonly newThread: (chatId: number) => Promise<string>
  readonly compactThread: (chatId: number) => Promise<void>
  readonly onConfigUpdate: (cfg: AppConfig) => void
  readonly persistChatState: (chatId: number, patch: { model?: string; reasoning?: ReasoningEffort | '' }) => Promise<void>
}

export async function sendHelp(chatId: number, sender: TelegramSender): Promise<void> {
  await sender.sendMessage(chatId, [
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

export async function sendStatus(chatId: number, ctx: CommandContext): Promise<void> {
  const lines = ['状态：']
  const threadId = ctx.chatToThread.get(chatId)
  if (threadId) {
    const cwd = await ctx.getCwd(threadId)
    lines.push(`会话：${threadId}`, `目录：${cwd || '（未设置）'}`)
  } else {
    lines.push('会话：（未绑定）')
  }
  const model = ctx.modelByChat.get(chatId)
  if (model) lines.push(`模型：${model}`)
  const reasoning = ctx.reasoningByChat.get(chatId)
  if (reasoning) lines.push(`推理深度：${reasoning}`)
  await ctx.sender.sendMessage(chatId, lines.join('\n'))
}

export async function handleTokenCommand(
  chatId: number, text: string, userId: string, ctx: CommandContext,
): Promise<void> {
  const isAdmin = ctx.config.users.length > 0 && ctx.config.users[0].id === userId
  if (!isAdmin) {
    await ctx.sender.sendMessage(chatId, '仅管理员可执行 /token 命令。')
    return
  }

  const parts = text.split(/\s+/)
  const sub = parts[1] ?? ''

  if (sub === 'create') {
    const name = parts.slice(2).join(' ').trim() || `user-${Date.now().toString(36)}`
    const result = await addUser(ctx.config, name)
    ctx.onConfigUpdate(result.config)
    await ctx.sender.sendMessage(chatId, [
      `✅ 用户已创建`,
      `名称: ${name}`,
      `Token: \`${result.token}\``,
      '',
      '将此 token 发送给对方即可绑定。',
    ].join('\n'), { parse_mode: 'Markdown' })
    return
  }

  if (sub === 'list') {
    const fresh = await loadConfig()
    const entries = listUsers(fresh)
    if (entries.length === 0) { await ctx.sender.sendMessage(chatId, '暂无用户。'); return }
    const lines = entries.map(e => {
      const tokens = e.tokens.map(t => `  - ${t.token.slice(0, 8)}... (${t.label ?? ''})`).join('\n')
      return `👤 ${e.user.name} (${e.user.id})\n${tokens || '  (无 token)'}`
    })
    await ctx.sender.sendMessage(chatId, lines.join('\n\n'))
    return
  }

  if (sub === 'revoke') {
    const token = parts[2]?.trim()
    if (!token) { await ctx.sender.sendMessage(chatId, '用法: /token revoke <token>'); return }
    const result = await revokeToken(ctx.config, token)
    if (!result) { await ctx.sender.sendMessage(chatId, 'Token 不存在。'); return }
    ctx.onConfigUpdate(result)
    await ctx.sender.sendMessage(chatId, `✅ Token ${token.slice(0, 8)}... 已吊销。`)
    return
  }

  // /token (no subcommand) — show current user's tokens
  const fresh = await loadConfig()
  const myTokens = fresh.tokens.filter(t => t.userId === userId)
  if (myTokens.length === 0) {
    await ctx.sender.sendMessage(chatId, '当前无 token。')
  } else {
    const lines = myTokens.map(t => `\`${t.token}\` (${t.label ?? ''})`)
    await ctx.sender.sendMessage(chatId, `你的 Token:\n${lines.join('\n')}`, { parse_mode: 'Markdown' })
  }
}

export async function handleModelCallback(
  chatId: number, cbId: string, model: string, ctx: CommandContext,
): Promise<void> {
  ctx.modelByChat.set(chatId, model)
  await ctx.persistChatState(chatId, { model })
  await ctx.sender.answerCallbackQuery(cbId, '模型已更新')
  await ctx.sender.sendMessage(chatId, `当前模型：${model}`)
}

export async function handleReasoningCallback(
  chatId: number, cbId: string, effort: string, ctx: CommandContext,
): Promise<void> {
  if (REASONING_EFFORTS.includes(effort as ReasoningEffort)) {
    ctx.reasoningByChat.set(chatId, effort as ReasoningEffort)
    await ctx.persistChatState(chatId, { reasoning: effort as ReasoningEffort })
    await ctx.sender.answerCallbackQuery(cbId, '推理深度已更新')
    await ctx.sender.sendMessage(chatId, `推理深度：${effort}`)
  } else {
    await ctx.sender.answerCallbackQuery(cbId, '无效')
  }
}

export async function handleContextCallback(
  chatId: number, cbId: string, action: string, ctx: CommandContext,
): Promise<void> {
  const threadId = ctx.chatToThread.get(chatId)
  if (!threadId) { await ctx.sender.answerCallbackQuery(cbId, '未绑定会话'); return }
  if (action === 'compact') {
    await ctx.compactThread(chatId)
    await ctx.sender.answerCallbackQuery(cbId, '正在压缩...')
  } else if (action === 'new') {
    await ctx.newThread(chatId)
    await ctx.sender.answerCallbackQuery(cbId, '已创建新会话')
  } else {
    await ctx.sender.answerCallbackQuery(cbId, '已忽略')
  }
}
