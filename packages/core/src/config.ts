import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

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
}

const CONFIG_DIR = join(homedir(), '.codex-app')
const CONFIG_PATH = join(CONFIG_DIR, 'config.json')

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
}

export function getConfigDir(): string {
  return CONFIG_DIR
}

export function loadConfig(): AppConfig {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }

  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2))
    return DEFAULT_CONFIG
  }

  const raw = readFileSync(CONFIG_PATH, 'utf-8')
  const parsed = JSON.parse(raw) as AppConfig
  return { ...DEFAULT_CONFIG, ...parsed }
}

export function saveConfig(config: AppConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
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

export function bootstrapConfig(): BootstrapResult {
  const config = loadConfig()

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

  saveConfig(newConfig)
  return { config: newConfig, created: true, adminToken: token }
}

export function addUser(config: AppConfig, name: string): { config: AppConfig; token: string; userId: string } {
  const userId = generateUserId()
  const token = generateToken()

  const newConfig: AppConfig = {
    ...config,
    users: [...config.users, { id: userId, name }],
    tokens: [...config.tokens, { token, userId, label: `${name}` }],
  }

  saveConfig(newConfig)
  return { config: newConfig, token, userId }
}

export function revokeToken(config: AppConfig, token: string): AppConfig | null {
  const entry = config.tokens.find(t => t.token === token)
  if (!entry) return null

  const newConfig: AppConfig = {
    ...config,
    tokens: config.tokens.filter(t => t.token !== token),
  }

  saveConfig(newConfig)
  return newConfig
}

export function listUsers(config: AppConfig): readonly { user: UserEntry; tokens: readonly TokenEntry[] }[] {
  return config.users.map(user => ({
    user,
    tokens: config.tokens.filter(t => t.userId === user.id),
  }))
}
