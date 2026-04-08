import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { appPaths } from '@/paths'

export type ChannelType = 'telegram' | 'wechat'

export type ChannelBinding = {
  readonly type: ChannelType
  readonly externalId: string      // TG chatId (string) or WX chatId
  readonly userId: string
  readonly threadId?: string       // current bound codex thread
  readonly cwd?: string            // per-chat working directory
  readonly model?: string          // per-chat model preference
  readonly reasoning?: string      // per-chat reasoning depth
  readonly updatedAt: string       // ISO timestamp
}

type BindingsFile = {
  readonly version: 2
  readonly bindings: readonly ChannelBinding[]
}

// ── Old format types (migration only) ──────────────────────────────────────

type OldBinding = { type: string; externalId: string; userId: string }
type OldChannelsFile = { bindings?: OldBinding[] }
type OldThreadMapping = { chatId: string; threadId: string }
type OldThreadsFile = { mappings?: OldThreadMapping[] }

// ── Internal IO ─────────────────────────────────────────────────────────────

async function readBindings(): Promise<readonly ChannelBinding[]> {
  await migrateIfNeeded()
  if (!existsSync(appPaths.bindings)) return []
  try {
    const data = JSON.parse(await readFile(appPaths.bindings, 'utf-8')) as BindingsFile
    return data.bindings ?? []
  } catch {
    return []
  }
}

async function writeBindings(bindings: readonly ChannelBinding[]): Promise<void> {
  const file: BindingsFile = { version: 2, bindings }
  await writeFile(appPaths.bindings, JSON.stringify(file, null, 2))
}

// ── Migration ────────────────────────────────────────────────────────────────

export async function migrateIfNeeded(): Promise<void> {
  if (existsSync(appPaths.bindings)) return

  const oldChannelsPath = join(appPaths.root, 'channels.json')
  if (!existsSync(oldChannelsPath)) return

  let oldBindings: OldBinding[] = []
  try {
    const raw = await readFile(oldChannelsPath, 'utf-8')
    const data = JSON.parse(raw) as OldChannelsFile
    oldBindings = data.bindings ?? []
  } catch {
    return
  }

  // Load TG thread mappings if available
  const threadMap = new Map<string, string>()
  const oldThreadsPath = join(appPaths.root, 'tg-threads.json')
  if (existsSync(oldThreadsPath)) {
    try {
      const raw = await readFile(oldThreadsPath, 'utf-8')
      const data = JSON.parse(raw) as OldThreadsFile
      for (const m of data.mappings ?? []) {
        threadMap.set(m.chatId, m.threadId)
      }
    } catch { /* ignore */ }
  }

  const migrated: ChannelBinding[] = oldBindings
    .filter((b): b is OldBinding & { type: ChannelType } =>
      b.type === 'telegram' || b.type === 'wechat'
    )
    .map(b => {
      const base: ChannelBinding = {
        type: b.type,
        externalId: b.externalId,
        userId: b.userId,
        updatedAt: new Date().toISOString(),
      }
      if (b.type === 'telegram') {
        const threadId = threadMap.get(b.externalId)
        return threadId ? { ...base, threadId } : base
      }
      return base
    })

  await writeBindings(migrated)
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function findBinding(type: ChannelType, externalId: string): Promise<ChannelBinding | null> {
  const bindings = await readBindings()
  return bindings.find(b => b.type === type && b.externalId === externalId) ?? null
}

export async function saveBinding(binding: ChannelBinding): Promise<void> {
  const bindings = await readBindings()
  const filtered = bindings.filter(
    b => !(b.type === binding.type && b.externalId === binding.externalId)
  )
  await writeBindings([...filtered, binding])
}

export async function updateBinding(
  type: ChannelType,
  externalId: string,
  patch: Partial<Omit<ChannelBinding, 'type' | 'externalId'>>,
): Promise<void> {
  const bindings = await readBindings()
  const existing = bindings.find(b => b.type === type && b.externalId === externalId)
  if (!existing) return
  const updated: ChannelBinding = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  await writeBindings([
    ...bindings.filter(b => !(b.type === type && b.externalId === externalId)),
    updated,
  ])
}

export async function listBindings(type?: ChannelType): Promise<readonly ChannelBinding[]> {
  const bindings = await readBindings()
  return type ? bindings.filter(b => b.type === type) : bindings
}

export async function loadAllBindings(type?: ChannelType): Promise<readonly ChannelBinding[]> {
  return listBindings(type)
}
