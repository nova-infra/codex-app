/**
 * channels.json persistence: WeChat externalId ↔ userId binding.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export type ChannelBinding = {
  type: 'wechat'
  externalId: string
  userId: string
}

type ChannelStore = { bindings: ChannelBinding[] }

export async function ensureDataDir(dataDir: string): Promise<void> {
  if (!existsSync(dataDir)) await mkdir(dataDir, { recursive: true })
}

async function loadStore(dataDir: string): Promise<ChannelStore> {
  const path = join(dataDir, 'channels.json')
  if (!existsSync(path)) return { bindings: [] }
  try {
    return JSON.parse(await readFile(path, 'utf8')) as ChannelStore
  } catch {
    return { bindings: [] }
  }
}

export async function resolveUserId(dataDir: string, chatId: string): Promise<string | null> {
  const store = await loadStore(dataDir)
  const binding = store.bindings.find((b) => b.type === 'wechat' && b.externalId === chatId)
  return binding?.userId ?? null
}

export async function saveChannelBinding(
  dataDir: string,
  chatId: string,
  userId: string,
): Promise<void> {
  const store = await loadStore(dataDir)
  const idx = store.bindings.findIndex((b) => b.type === 'wechat' && b.externalId === chatId)
  const binding: ChannelBinding = { type: 'wechat', externalId: chatId, userId }
  const bindings = idx >= 0
    ? store.bindings.map((b, i) => (i === idx ? binding : b))
    : [...store.bindings, binding]
  await writeFile(join(dataDir, 'channels.json'), JSON.stringify({ bindings }, null, 2))
}
