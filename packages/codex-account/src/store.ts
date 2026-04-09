import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { AccountData, CodexAccount } from './types'

const DATA_DIR = join(homedir(), '.codex-app')
const ACCOUNTS_PATH = join(DATA_DIR, 'codex-accounts.json')
const CODEX_DIR = join(homedir(), '.codex')
const CODEX_AUTH_PATH = join(CODEX_DIR, 'auth.json')

export { ACCOUNTS_PATH }

export type CodexAuthSnapshot = {
  readonly auth_mode?: string
  readonly OPENAI_API_KEY?: string | null
  readonly tokens?: {
    readonly id_token?: string
    readonly access_token?: string
    readonly refresh_token?: string
    readonly account_id?: string
  } | null
  readonly last_refresh?: string
}

const EMPTY_DATA: AccountData = Object.freeze({
  activeAccountId: null,
  accounts: Object.freeze([]) as readonly CodexAccount[],
})

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

function isCodexAccount(value: unknown): value is CodexAccount {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' &&
    typeof record.email === 'string' &&
    typeof record.accountId === 'string' &&
    typeof record.accessToken === 'string' &&
    typeof record.refreshToken === 'string' &&
    typeof record.planType === 'string' &&
    typeof record.expired === 'string' &&
    typeof record.lastRefresh === 'string' &&
    typeof record.disabled === 'boolean' &&
    typeof record.createdAt === 'string'
}

function normalizeAccountData(raw: Partial<AccountData>): AccountData {
  const accounts = Array.isArray(raw.accounts) ? raw.accounts.filter(isCodexAccount) : []
  const activeAccountId = typeof raw.activeAccountId === 'string' && accounts.some(a => a.id === raw.activeAccountId)
    ? raw.activeAccountId
    : null
  return { activeAccountId, accounts }
}

export async function loadAccounts(): Promise<AccountData> {
  await ensureDir(DATA_DIR)

  if (!existsSync(ACCOUNTS_PATH)) {
    return EMPTY_DATA
  }

  try {
    const raw = await readFile(ACCOUNTS_PATH, 'utf-8')
    return normalizeAccountData(JSON.parse(raw) as Partial<AccountData>)
  } catch {
    return EMPTY_DATA
  }
}

export async function saveAccounts(data: AccountData): Promise<void> {
  await ensureDir(DATA_DIR)
  await writeFile(ACCOUNTS_PATH, JSON.stringify(data, null, 2))
}

export async function readCodexAuthFile(): Promise<CodexAuthSnapshot | null> {
  if (!existsSync(CODEX_AUTH_PATH)) return null
  const raw = await readFile(CODEX_AUTH_PATH, 'utf-8')
  try {
    return JSON.parse(raw) as CodexAuthSnapshot
  } catch {
    return null
  }
}

export function getActiveAccount(data: AccountData): CodexAccount | null {
  if (!data.activeAccountId) return null
  return data.accounts.find(a => a.id === data.activeAccountId) ?? null
}

export function generateAccountId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 6)
  return `acct_${ts}_${rand}`
}

/** Write active account token to ~/.codex/auth.json and process.env for hot-swap without restart. */
export async function applyAuthFile(account: CodexAccount): Promise<void> {
  await ensureDir(CODEX_DIR)
  const payload = {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      id_token: account.idToken ?? '',
      access_token: account.accessToken,
      refresh_token: account.refreshToken,
      account_id: account.accountId,
    },
    last_refresh: account.lastRefresh,
  }
  await writeFile(CODEX_AUTH_PATH, JSON.stringify(payload, null, 2))
  process.env['OPENAI_API_KEY'] = account.accessToken
}

/** Remove credentials from ~/.codex/auth.json and process.env when no accounts remain. */
export async function clearAuthFile(): Promise<void> {
  await ensureDir(CODEX_DIR)
  await writeFile(CODEX_AUTH_PATH, JSON.stringify({
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: null,
    last_refresh: null,
  }, null, 2))
  delete process.env['OPENAI_API_KEY']
}
