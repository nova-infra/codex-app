import type { AccountManager } from './manager'
import type { CommandReply } from './command-types'

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Render a 10-segment Unicode block progress bar. */
export function progressBar(percent: number): string {
  const used = Math.min(100, Math.max(0, percent))
  const remaining = Math.max(0, 100 - used)
  const filled = Math.round((remaining / 100) * 10)
  return `[${'█'.repeat(filled)}${'░'.repeat(10 - filled)}]`
}

function fmtRemaining(iso: string): string {
  if (!iso) return ''
  const ms = new Date(iso).getTime() - Date.now()
  if (!Number.isFinite(ms)) return ''
  if (ms <= 0) return '已到期'
  const totalMinutes = Math.ceil(ms / 60_000)
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d`
  if (hours > 0) return `${hours}h`
  return `${minutes}m`
}

// ── Command handlers ──────────────────────────────────────────────────────────

export async function handleList(manager: AccountManager): Promise<CommandReply> {
  const accounts = manager.list()
  if (accounts.length === 0) {
    return { text: '尚无 Codex 账号。\n使用 /cx login 登录或 /cx token <refreshToken> 添加。' }
  }
  const lines = accounts.map(a =>
    `${a.email} (${a.planType})${a.isActive ? ' ✦当前' : ''}`,
  )
  return { text: `Codex 账号列表：\n${lines.join('\n')}` }
}

export async function handleLogin(manager: AccountManager): Promise<CommandReply> {
  const { authUrl, state } = await manager.initiateLogin()
  return {
    text: '点击下方按钮授权 Codex 账号（链接 10 分钟内有效）：',
    buttons: [[{ label: '登录 OpenAI', action: 'oauth_open', url: authUrl }]],
    pendingAction: { kind: 'oauth_login', state },
  }
}

export async function handleToken(text: string, manager: AccountManager): Promise<CommandReply> {
  const match = text.match(/^\/cx\s+token\s+(\S+)/i)
  if (!match) {
    return { text: '用法：/cx token <refreshToken>' }
  }
  const refreshToken = match[1]!
  try {
    const account = await manager.addByRefreshToken(refreshToken)
    return { text: `✓ 账号已添加：${account.email} (${account.planType})` }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { text: `✗ 添加失败：${msg}` }
  }
}

export async function handleSwitch(manager: AccountManager): Promise<CommandReply> {
  const available = manager.list().filter(a => !a.isActive && !a.disabled)
  if (available.length === 0) {
    return { text: '没有其他可切换的账号。' }
  }
  const buttons = available.map(a => [{ label: a.email, action: `cx:switch:${a.id}` }])
  return { text: '选择要切换的账号：', buttons }
}

export async function handleUsage(manager: AccountManager): Promise<CommandReply> {
  const accounts = manager.list()
  if (accounts.length === 0) {
    return { text: '没有可用账号。使用 /cx login 添加。' }
  }

  await manager.refreshAll()
  const settled = await Promise.allSettled(
    accounts.map(a => manager.getUsage(a.id).then(usage => ({ account: a, usage }))),
  )

  const lines: string[] = []
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      const { account, usage } = result.value
      const used5h = Math.min(100, Math.max(0, usage.session5h.usedPercent))
      const usedWeekly = Math.min(100, Math.max(0, usage.weekly.usedPercent))
      lines.push(
        `${account.email}${account.isActive ? ' ✦当前' : ''}`,
        `5h  ${progressBar(usage.session5h.usedPercent)} ${100 - used5h}% ${fmtRemaining(usage.session5h.resetAt)}`.trimEnd(),
        `周  ${progressBar(usage.weekly.usedPercent)} ${100 - usedWeekly}% ${fmtRemaining(usage.weekly.resetAt)}`.trimEnd(),
        ...(usage.limitReached ? ['⚠ 用量已达上限'] : []),
        '',
      )
    } else {
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason)
      lines.push(`✗ 获取用量失败：${msg}`, '')
    }
  }

  return { text: lines.join('\n').trimEnd() }
}

export async function handleRefresh(text: string, manager: AccountManager): Promise<CommandReply> {
  const match = text.match(/^\/cx\s+refresh\s+(\S+)/i)
  if (match) {
    const id = match[1]!
    try {
      const account = await manager.refreshAccount(id)
      return { text: `✓ 已刷新：${account.email}` }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { text: `✗ 刷新失败：${msg}` }
    }
  }

  const results = await manager.refreshAll()
  if (results.length === 0) {
    return { text: '没有账号可刷新。' }
  }
  const lines = results.map(r =>
    r.success ? `✓ ${r.email}` : `✗ ${r.email}：${r.error}`,
  )
  return { text: `刷新结果：\n${lines.join('\n')}` }
}

export async function handleRemove(manager: AccountManager): Promise<CommandReply> {
  const accounts = manager.list()
  if (accounts.length === 0) {
    return { text: '没有可删除的账号。' }
  }
  const buttons = accounts.map(a => [{ label: a.email, action: `cx:remove:${a.id}` }])
  return { text: '选择要删除的账号：', buttons }
}

// ── Button callbacks: cx:switch:{id} / cx:remove:{id} ─────────────────────────

export async function handleCxCallback(
  callbackData: string,
  manager: AccountManager,
): Promise<CommandReply | null> {
  if (callbackData.startsWith('cx:switch:')) {
    const id = callbackData.slice('cx:switch:'.length)
    const ok = await manager.switchTo(id)
    if (!ok) return { text: '✗ 账号不存在或已禁用' }
    const active = manager.getActiveAccount()
    return { text: `✓ 已切换到：${active?.email ?? id}` }
  }

  if (callbackData.startsWith('cx:remove:')) {
    const id = callbackData.slice('cx:remove:'.length)
    const existing = manager.list().find(a => a.id === id)
    const ok = await manager.remove(id)
    if (!ok) return { text: '✗ 账号不存在' }
    return { text: `✓ 已删除：${existing?.email ?? id}` }
  }

  return null
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

const HELP_TEXT = [
  'Codex 账号管理 (/cx)',
  '',
  '/cx              — 列出所有账号',
  '/cx login        — 浏览器 OAuth 登录',
  '/cx token <t>    — 用 refreshToken 添加',
  '/cx switch       — 切换活跃账号',
  '/cx usage        — 查看所有账号用量',
  '/cx refresh [id] — 刷新 token（默认全部）',
  '/cx remove       — 删除账号',
].join('\n')

/**
 * Parse and dispatch a /cx command.
 * Returns null if text does not start with /cx.
 */
export async function handleCxCommand(
  text: string,
  manager: AccountManager,
): Promise<CommandReply | null> {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/cx')) return null

  const parts = trimmed.split(/\s+/)
  const sub = (parts[1] ?? '').toLowerCase()

  switch (sub) {
    case '':
      return handleList(manager)
    case 'login':
      return handleLogin(manager)
    case 'token':
      return handleToken(trimmed, manager)
    case 'switch':
      return handleSwitch(manager)
    case 'usage':
      return handleUsage(manager)
    case 'refresh':
      return handleRefresh(trimmed, manager)
    case 'remove':
      return handleRemove(manager)
    default:
      return { text: HELP_TEXT }
  }
}
