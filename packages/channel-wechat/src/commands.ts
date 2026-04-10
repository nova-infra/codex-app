import type { CodexClient } from '@codex-app/core'
import type { AccountManager } from '@codex-app/codex-account'
import { callbackRegistry, handleRefresh, handleUsage, type ChannelCallbackContext } from '@codex-app/codex-account'
import type { PollerStatus } from '@/polling'

const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const

type WechatCommandContext = {
  readonly codex: CodexClient
  readonly accountManager: AccountManager | null
  readonly getPollerStatus: () => PollerStatus
  readonly sendRaw: (chatId: string, text: string) => Promise<void>
  readonly getThreadId: (chatId: string) => string | undefined
  readonly getModel: (chatId: string) => string | undefined
  readonly getReasoning: (chatId: string) => string | undefined
  readonly readThreadCwd: (threadId: string) => Promise<string>
  readonly setModel: (chatId: string, model: string) => Promise<void>
  readonly setReasoning: (chatId: string, effort: string) => Promise<void>
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

export async function sendHelp(chatId: string, ctx: WechatCommandContext): Promise<void> {
  const lines = [
    '可用指令：',
    '/new - 新建会话',
    '/session - 选择会话',
    '/project <path> - 设置项目目录',
    '/model [名称] - 查看或设置模型',
    '/reasoning [深度] - 查看或设置推理',
    '/cx - Codex 账号管理',
    '/status - 查看状态',
    '/help - 查看指令说明',
  ]
  const threadId = ctx.getThreadId(chatId)
  if (threadId) {
    const cwd = await ctx.readThreadCwd(threadId)
    lines.push('', `当前绑定会话：${threadId}`, cwd ? `当前目录：${cwd}` : '当前目录：（未设置）')
  }
  await ctx.sendRaw(chatId, lines.join('\n'))
}

export async function sendStatus(chatId: string, ctx: WechatCommandContext): Promise<void> {
  const lines = ['状态：']
  const threadId = ctx.getThreadId(chatId)
  if (threadId) {
    const cwd = await ctx.readThreadCwd(threadId)
    lines.push(`会话：${threadId}`, `目录：${cwd || '（未设置）'}`)
  } else {
    lines.push('会话：（未绑定）')
  }
  const model = ctx.getModel(chatId)
  const reasoning = ctx.getReasoning(chatId)
  if (model) lines.push(`模型：${model}`)
  if (reasoning) lines.push(`推理：${reasoning}`)
  const account = ctx.accountManager?.getActiveAccount()
  if (account) lines.push(`Codex 账号：${account.email} (${account.planType})`)
  const poller = ctx.getPollerStatus()
  lines.push(
    `登录状态：${poller.loginState}`,
    `已配置：${poller.configured ? '是' : '否'}`,
    `baseUrl：${poller.baseUrl || '（未设置）'}`,
  )
  if (poller.lastError) lines.push(`最近错误：${poller.lastError}`)
  await ctx.sendRaw(chatId, lines.join('\n'))
}

export async function sendThreadPicker(chatId: string, ctx: WechatCommandContext): Promise<void> {
  const payload = asRecord(await ctx.codex.call('thread/list', { archived: false, limit: 20, sortKey: 'updated_at' }))
  const rows = Array.isArray(payload?.data) ? payload.data : []
  const current = ctx.getThreadId(chatId)
  const parts: string[] = []
  for (const row of rows) {
    const rec = asRecord(row)
    const id = typeof rec?.id === 'string' ? rec.id.trim() : ''
    if (!id) continue
    const name = (typeof rec?.name === 'string' ? rec.name : '') || (typeof rec?.preview === 'string' ? rec.preview : '') || id
    const cwd = typeof rec?.cwd === 'string' ? rec.cwd.trim() : ''
    parts.push(`${id === current ? '✓ ' : ''}${cwd || '(未设置)'}/${name.slice(0, 40)}\n/thread ${id}`)
  }
  await ctx.sendRaw(chatId, parts.length ? `选择会话：\n\n${parts.join('\n\n')}` : '没有会话。发送 /new 创建。')
}

export async function handleModelCommand(chatId: string, cmd: string, ctx: WechatCommandContext): Promise<boolean> {
  const trimmed = cmd.trim()
  if (trimmed === '/model') {
    const payload = asRecord(await ctx.codex.call('model/list', {}))
    const rows = Array.isArray(payload?.data) ? payload.data : []
    const models = [...new Set(rows.flatMap((row: unknown) => {
      const rec = asRecord(row)
      return typeof rec?.id === 'string' ? [rec.id] : typeof rec?.model === 'string' ? [rec.model] : []
    }))]
    const current = ctx.getModel(chatId)
    const text = models.length
      ? `可用模型：\n${models.map((model) => `${model === current ? '✓ ' : ''}${model}`).join('\n')}\n\n设置方式：/model <名称>`
      : '没有可用模型。'
    await ctx.sendRaw(chatId, text)
    return true
  }
  const match = trimmed.match(/^\/model\s+(.+)$/)
  if (!match) return false
  const model = match[1]!.trim()
  await ctx.setModel(chatId, model)
  await ctx.sendRaw(chatId, `模型已设为：${model}`)
  return true
}

export async function handleReasoningCommand(chatId: string, cmd: string, ctx: WechatCommandContext): Promise<boolean> {
  const trimmed = cmd.trim()
  if (trimmed === '/reasoning') {
    const current = ctx.getReasoning(chatId)
    await ctx.sendRaw(
      chatId,
      `可用推理深度：\n${REASONING_EFFORTS.map((effort) => `${effort === current ? '✓ ' : ''}${effort}`).join('\n')}\n\n设置方式：/reasoning <深度>`,
    )
    return true
  }
  const match = trimmed.match(/^\/reasoning\s+(\S+)$/)
  if (!match) return false
  const effort = match[1]!.trim()
  if (!REASONING_EFFORTS.includes(effort as typeof REASONING_EFFORTS[number])) {
    await ctx.sendRaw(chatId, '无效推理深度。')
    return true
  }
  await ctx.setReasoning(chatId, effort)
  await ctx.sendRaw(chatId, `推理深度已设为：${effort}`)
  return true
}

export async function handleCxText(chatId: string, text: string, ctx: WechatCommandContext): Promise<boolean> {
  const manager = ctx.accountManager
  if (!manager || !text.trim().startsWith('/cx')) return false
  const parts = text.trim().split(/\s+/)
  const sub = (parts[1] ?? '').toLowerCase()

  if (sub === '') {
    const accounts = manager.list()
    await ctx.sendRaw(
      chatId,
      accounts.length
        ? `Codex 账号：\n${accounts.map((a) => `${a.email} (${a.planType})${a.isActive ? ' ✦当前' : ''}\n  id: ${a.id}`).join('\n')}`
        : '尚无 Codex 账号。\n使用 /cx login 或 /cx token <refreshToken> 添加。',
    )
    return true
  }
  if (sub === 'login') {
    const { authUrl, state } = await manager.initiateLogin()
    const callbackCtx: ChannelCallbackContext = {
      channelType: 'wechat',
      chatId,
      state,
      createdAt: Date.now(),
    }
    callbackRegistry.register(callbackCtx)
    await ctx.sendRaw(chatId, `打开链接登录（10 分钟内有效）：\n${authUrl}`)
    return true
  }
  if (sub === 'token') {
    const token = parts[2]?.trim()
    if (!token) {
      await ctx.sendRaw(chatId, '用法：/cx token <refreshToken>')
      return true
    }
    try {
      const account = await manager.addByRefreshToken(token)
      await ctx.sendRaw(chatId, `账号已添加：${account.email} (${account.planType})`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await ctx.sendRaw(chatId, `添加失败：${message}`)
    }
    return true
  }
  if (sub === 'usage') {
    const reply = await handleUsage(manager)
    await ctx.sendRaw(chatId, reply.text)
    return true
  }
  if (sub === 'refresh') {
    const reply = await handleRefresh(text.trim(), manager)
    await ctx.sendRaw(chatId, reply.text)
    return true
  }
  if (sub === 'switch') {
    const id = parts[2]?.trim()
    if (!id) {
      const available = manager.list().filter((a) => !a.disabled)
      await ctx.sendRaw(chatId, available.length
        ? `可切换账号：\n${available.map((a) => `${a.email}\n  /cx switch ${a.id}`).join('\n')}`
        : '没有可切换的账号。')
      return true
    }
    const ok = await manager.switchTo(id)
    await ctx.sendRaw(chatId, ok ? `已切换到：${manager.getActiveAccount()?.email ?? id}` : '账号不存在或已禁用')
    return true
  }
  if (sub === 'remove') {
    const id = parts[2]?.trim()
    if (!id) {
      const accounts = manager.list()
      await ctx.sendRaw(chatId, accounts.length
        ? `可删除账号：\n${accounts.map((a) => `${a.email}\n  /cx remove ${a.id}`).join('\n')}`
        : '没有可删除的账号。')
      return true
    }
    const existing = manager.list().find((a) => a.id === id)
    const ok = await manager.remove(id)
    await ctx.sendRaw(chatId, ok ? `已删除：${existing?.email ?? id}` : '账号不存在')
    return true
  }
  await ctx.sendRaw(chatId, [
    'Codex 账号管理：',
    '/cx',
    '/cx login',
    '/cx token <refreshToken>',
    '/cx switch [id]',
    '/cx usage',
    '/cx refresh [id]',
    '/cx remove [id]',
  ].join('\n'))
  return true
}
