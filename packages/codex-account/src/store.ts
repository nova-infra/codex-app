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

const EMPTY_DATA: AccountData = Object.freeze({
  activeAccountId: null,
  accounts: Object.freeze([]) as readonly CodexAccount[],
})

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

export async function loadAccounts(): Promise<AccountData> {
  await ensureDir(DATA_DIR)

  if (!existsSync(ACCOUNTS_PATH)) {
    return EMPTY_DATA
  }

  const raw = await readFile(ACCOUNTS_PATH, 'utf-8')
  const parsed = JSON.parse(raw) as Partial<AccountData>
  return {
    activeAccountId: parsed.activeAccountId ?? null,
    accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
  }
}

export async function saveAccounts(data: AccountData): Promise<void> {
  await ensureDir(DATA_DIR)
  await writeFile(ACCOUNTS_PATH, JSON.stringify(data, null, 2))
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
  await writeFile(CODEX_AUTH_PATH, JSON.stringify({ OPENAI_API_KEY: account.accessToken }, null, 2))
  process.env['OPENAI_API_KEY'] = account.accessToken
}

/** Remove credentials from ~/.codex/auth.json and process.env when no accounts remain. */
export async function clearAuthFile(): Promise<void> {
  await ensureDir(CODEX_DIR)
  await writeFile(CODEX_AUTH_PATH, JSON.stringify({}, null, 2))
  delete process.env['OPENAI_API_KEY']
}
