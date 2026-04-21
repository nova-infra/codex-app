import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { appPaths, ensureDirs } from '@/paths'
import type { ChannelKey } from '@/registry/channelRegistry'
import type { CapabilityKey } from '@/registry/capabilityRegistry'
import { listChannels } from '@/registry/channelRegistry'
import { listCapabilities } from '@/registry/capabilityRegistry'

export type UserEntry = {
  readonly id: string
  readonly name: string
}

export type TokenEntry = {
  readonly token: string
  readonly userId: string
  readonly label?: string
}

export type TelegramConfig = {
  readonly botToken: string
  readonly renderMode?: 'classic' | 'hermes'
}

export type WechatConfig = {
  readonly enabled: boolean
}

export type WebConfig = {
  readonly enabled: boolean
  readonly transport: 'ws'
}

export type ChannelConfigMap = {
  readonly web: WebConfig
  readonly telegram: TelegramConfig & { readonly enabled: boolean }
  readonly wechat: WechatConfig
}

export type CapabilityConfigMap = Readonly<Record<CapabilityKey, { readonly enabled: boolean; readonly driver?: string }>>

export type CodexConfig = {
  readonly port: number
  readonly model: string
  readonly approvalPolicy: string
  readonly sandbox: string
}

export type RuntimeConfig = {
  readonly gateway: {
    readonly transport: 'ws'
  }
  readonly codex: {
    readonly transport: 'app-server-ws'
  }
  readonly policy: {
    readonly autoCompact: {
      readonly enabled: boolean
      readonly mode: 'manual' | 'suggest' | 'automatic'
      readonly thresholdRatio: number
    }
  }
}

export type AppConfig = {
  readonly port: number
  readonly codex: CodexConfig
  readonly users: readonly UserEntry[]
  readonly tokens: readonly TokenEntry[]
  readonly channels: ChannelConfigMap
  readonly capabilities: CapabilityConfigMap
  readonly runtime: RuntimeConfig
  readonly telegram?: TelegramConfig
  readonly wechat?: WechatConfig
  readonly defaultCwd?: string
  readonly streaming?: {
    readonly enabled?: boolean
    readonly editIntervalMs?: number
    readonly minChars?: number
    readonly maxChars?: number
    readonly idleMs?: number
  }
}

function defaultChannels(): ChannelConfigMap {
  const defaults = Object.fromEntries(listChannels().map(channel => [channel.key, channel.defaultEnabled])) as Record<ChannelKey, boolean>
  return {
    web: { enabled: defaults.web, transport: 'ws' },
    telegram: { enabled: defaults.telegram, botToken: '', renderMode: 'classic' },
    wechat: { enabled: defaults.wechat },
  }
}

function defaultCapabilities(): CapabilityConfigMap {
  const entries = listCapabilities().map(capability => {
    return [capability.key, { enabled: capability.defaultEnabled }]
  })
  return Object.fromEntries(entries) as CapabilityConfigMap
}

const DEFAULT_CONFIG: AppConfig = {
  port: 8765,
  codex: {
    port: 8766,
    model: 'o3',
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
  },
  users: [],
  tokens: [],
  channels: defaultChannels(),
  capabilities: defaultCapabilities(),
  runtime: {
    gateway: { transport: 'ws' },
    codex: { transport: 'app-server-ws' },
    policy: {
      autoCompact: {
        enabled: true,
        mode: 'suggest',
        thresholdRatio: 0.8,
      },
    },
  },
  streaming: {
    enabled: true,
    editIntervalMs: 2000,
    minChars: 80,
    maxChars: 2000,
    idleMs: 600,
  },
}

/** @deprecated Use appPaths.root instead */
export function getConfigDir(): string {
  return appPaths.root
}

export async function loadConfig(): Promise<AppConfig> {
  await ensureDirs(appPaths)

  if (!existsSync(appPaths.config)) {
    await writeFile(appPaths.config, JSON.stringify(DEFAULT_CONFIG, null, 2))
    return DEFAULT_CONFIG
  }

  const raw = await readFile(appPaths.config, 'utf-8')
  const parsed = JSON.parse(raw) as Partial<AppConfig>
  const telegram = parsed.channels?.telegram
    ?? (parsed.telegram ? { enabled: true, botToken: parsed.telegram.botToken, renderMode: parsed.telegram.renderMode ?? 'classic' } : undefined)
  const wechat = parsed.channels?.wechat
    ?? (parsed.wechat ? { enabled: parsed.wechat.enabled } : undefined)

  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    channels: {
      ...DEFAULT_CONFIG.channels,
      ...(parsed.channels ?? {}),
      ...(telegram ? { telegram } : {}),
      ...(wechat ? { wechat } : {}),
    },
    capabilities: {
      ...DEFAULT_CONFIG.capabilities,
      ...(parsed.capabilities ?? {}),
    },
    runtime: {
      ...DEFAULT_CONFIG.runtime,
      ...(parsed.runtime ?? {}),
      policy: {
        ...DEFAULT_CONFIG.runtime.policy,
        ...(parsed.runtime?.policy ?? {}),
        autoCompact: {
          ...DEFAULT_CONFIG.runtime.policy.autoCompact,
          ...(parsed.runtime?.policy?.autoCompact ?? {}),
        },
      },
    },
    telegram,
    wechat,
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await ensureDirs(appPaths)
  const { telegram: _telegram, wechat: _wechat, ...persisted } = config
  await writeFile(appPaths.config, JSON.stringify(persisted, null, 2))
}

function generateToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function generateUserId(): string {
  return `u${Date.now().toString(36)}`
}

export type BootstrapResult = {
  readonly config: AppConfig
  readonly created: boolean
  readonly adminToken?: string
}

export async function bootstrapConfig(): Promise<BootstrapResult> {
  const config = await loadConfig()

  if (config.users.length > 0) {
    return { config, created: false }
  }

  const userId = generateUserId()
  const token = generateToken()

  const newConfig: AppConfig = {
    ...config,
    users: [{ id: userId, name: 'admin' }],
    tokens: [{ token, userId, label: 'auto-generated' }],
  }

  await saveConfig(newConfig)
  return { config: newConfig, created: true, adminToken: token }
}

export async function addUser(config: AppConfig, name: string): Promise<{ config: AppConfig; token: string; userId: string }> {
  const userId = generateUserId()
  const token = generateToken()

  const newConfig: AppConfig = {
    ...config,
    users: [...config.users, { id: userId, name }],
    tokens: [...config.tokens, { token, userId, label: `${name}` }],
  }

  await saveConfig(newConfig)
  return { config: newConfig, token, userId }
}

export async function revokeToken(config: AppConfig, token: string): Promise<AppConfig | null> {
  const entry = config.tokens.find(t => t.token === token)
  if (!entry) return null

  const newConfig: AppConfig = {
    ...config,
    tokens: config.tokens.filter(t => t.token !== token),
  }

  await saveConfig(newConfig)
  return newConfig
}

export function listUsers(config: AppConfig): readonly { user: UserEntry; tokens: readonly TokenEntry[] }[] {
  return config.users.map(user => ({
    user,
    tokens: config.tokens.filter(t => t.userId === user.id),
  }))
}
