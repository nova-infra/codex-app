import type { CodexClient, SessionControlService } from '@codex-app/core'
import type { PollerStatus } from '@/polling'

const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const

type WechatCommandContext = {
  readonly codex: CodexClient
  readonly sessions: SessionControlService
  readonly getPollerStatus: () => PollerStatus
  readonly sendRaw: (chatId: string, text: string) => Promise<void>
  readonly getUserId: (chatId: string) => Promise<string>
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
  const current = ctx.getThreadId(chatId)
  const parts: string[] = []
  const rows = await ctx.sessions.listOwnedThreads(await ctx.getUserId(chatId), 20)
  for (const row of rows) {
    const id = row.id.trim()
    const name = row.name || id
    const cwd = row.cwd.trim()
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
