import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppConfig } from '@codex-app/core'

let cachedProvider: string | null | undefined

async function readCodexProvider(): Promise<string | null> {
  if (cachedProvider !== undefined) return cachedProvider
  try {
    const home = process.env.HOME || '/root'
    const raw = await readFile(join(home, '.codex', 'config.toml'), 'utf8')
    const match = raw.match(/^\s*model_provider\s*=\s*["']?([^"'\n#]+)["']?/m)
    cachedProvider = match?.[1]?.trim() || null
  } catch {
    cachedProvider = null
  }
  return cachedProvider
}

export async function buildTelegramContextSummary(params: {
  readonly chatId: number
  readonly config: AppConfig
  readonly getUserId: (chatId: number) => Promise<string>
  readonly model?: string
  readonly threadId?: string
  readonly cwd?: string
}): Promise<string[]> {
  const userId = await params.getUserId(params.chatId).catch(() => '')
  const user = params.config.users.find(u => u.id === userId)
  const provider = await readCodexProvider()
  const model = params.model || params.config.codex.model || '（未设置）'
  const lines = [
    `Agent：${user?.name ?? (userId || '（未绑定）')}`,
    `模型：${provider ? `${provider}/` : ''}${model}`,
  ]
  if (params.threadId) lines.push(`会话：${params.threadId}`)
  if (params.cwd !== undefined) lines.push(`目录：${params.cwd || '（未设置）'}`)
  return lines
}
