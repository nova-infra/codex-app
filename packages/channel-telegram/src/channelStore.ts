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
