import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { appPaths, ensureDirs } from '@/paths'

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

export type CodexConfig = {
  readonly port: number
  readonly model: string
  readonly approvalPolicy: string
  readonly sandbox: string
}

export type AppConfig = {
  readonly port: number
  readonly codex: CodexConfig
  readonly users: readonly UserEntry[]
  readonly tokens: readonly TokenEntry[]
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
  const parsed = JSON.parse(raw) as AppConfig
  return { ...DEFAULT_CONFIG, ...parsed }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await ensureDirs(appPaths)
  await writeFile(appPaths.config, JSON.stringify(config, null, 2))
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
