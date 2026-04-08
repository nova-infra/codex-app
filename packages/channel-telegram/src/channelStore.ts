import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CHANNELS_PATH = join(homedir(), '.codex-app', 'channels.json')

export type ChannelBinding = {
  readonly type: 'telegram' | 'wechat'
  readonly externalId: string
  readonly userId: string
}

type ChannelsFile = {
  readonly bindings?: readonly ChannelBinding[]
}

function readBindings(): readonly ChannelBinding[] {
  if (!existsSync(CHANNELS_PATH)) return []
  try {
    const data = JSON.parse(readFileSync(CHANNELS_PATH, 'utf-8')) as ChannelsFile
    return data.bindings ?? []
  } catch {
    return []
  }
}

function writeBindings(bindings: readonly ChannelBinding[]): void {
  writeFileSync(CHANNELS_PATH, JSON.stringify({ bindings }, null, 2))
}

export function findBinding(type: ChannelBinding['type'], externalId: string): ChannelBinding | null {
  return readBindings().find(b => b.type === type && b.externalId === externalId) ?? null
}

export function saveBinding(binding: ChannelBinding): void {
  const existing = readBindings().filter(
    b => !(b.type === binding.type && b.externalId === binding.externalId),
  )
  writeBindings([...existing, binding])
}

// Thread mapping persistence (chatId → threadId)
type ThreadMapping = { readonly chatId: string; readonly threadId: string }
type ThreadMappingsFile = { readonly mappings?: readonly ThreadMapping[] }

const THREAD_MAP_PATH = join(homedir(), '.codex-app', 'tg-threads.json')

export function loadThreadMappings(): ReadonlyMap<number, string> {
  if (!existsSync(THREAD_MAP_PATH)) return new Map()
  try {
    const data = JSON.parse(readFileSync(THREAD_MAP_PATH, 'utf-8')) as ThreadMappingsFile
    const map = new Map<number, string>()
    for (const m of data.mappings ?? []) {
      map.set(Number(m.chatId), m.threadId)
    }
    return map
  } catch { return new Map() }
}

export function saveThreadMapping(chatId: number, threadId: string): void {
  const existing = loadThreadMappings()
  const updated = new Map(existing)
  updated.set(chatId, threadId)
  const mappings = Array.from(updated.entries()).map(([c, t]) => ({ chatId: String(c), threadId: t }))
  writeFileSync(THREAD_MAP_PATH, JSON.stringify({ mappings }, null, 2))
}
