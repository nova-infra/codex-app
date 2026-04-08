import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

export type TokenEntry = {
  readonly token: string
  readonly label?: string
}

export type TelegramConfig = {
  readonly botToken: string
  readonly webhookUrl: string
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
