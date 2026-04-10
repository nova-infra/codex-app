import type { AccountData, CodexAccount, MaskedAccount, AccountUsage, OAuthState, RefreshResult } from './types'
import { loadAccounts, saveAccounts, getActiveAccount, generateAccountId, applyAuthFile, clearAuthFile, readCodexAuthFile } from './store'
import { extractAccountInfo, decodeJwtPayload } from './jwt'
import { generateCodeVerifier, generateCodeChallenge, generateState, buildAuthUrl, exchangeCode, refreshTokens } from './oauth'
import type { TokenResponse } from './oauth'
import { fetchUsage } from './usage'

/** Max age for pending OAuth states (10 minutes). */
const STATE_TTL_MS = 10 * 60 * 1000
export class AccountManager {
  private data: AccountData = { activeAccountId: null, accounts: [] }
  private readonly pendingStates = new Map<string, OAuthState>()

  constructor(private readonly callbackPort: number) {}

  async load(): Promise<boolean> {
    this.data = await loadAccounts()
    if (this.data.accounts.length === 0) {
      return this.importExistingCodexAuth()
    }
    return false
  }

  // ── Auth method 1: Login (browser OAuth PKCE) ────────────────────────────

  async initiateLogin(): Promise<{ readonly authUrl: string; readonly state: string }> {
    this.pruneExpiredStates()

    const codeVerifier = generateCodeVerifier()
    const codeChallenge = await generateCodeChallenge(codeVerifier)
    const state = generateState()

    this.pendingStates.set(state, { state, codeVerifier, createdAt: Date.now() })

    const authUrl = buildAuthUrl(state, codeChallenge, this.callbackPort)
    return { authUrl, state }
  }

  async handleCallback(code: string, state: string): Promise<MaskedAccount> {
    const pending = this.pendingStates.get(state)
    if (!pending) {
      throw new Error('Invalid or expired OAuth state')
    }
    this.pendingStates.delete(state)

    // Enforce 10-minute TTL on OAuth states
    if (Date.now() - pending.createdAt > STATE_TTL_MS) {
      throw new Error('OAuth state expired (10 min)')
    }

    const tokens = await exchangeCode(code, pending.codeVerifier, this.callbackPort)
    return this.saveFromTokens(tokens)
  }

  // ── Auth method 2: Authorization Code (manual) ───────────────────────────

  async addByCode(code: string, codeVerifier: string): Promise<MaskedAccount> {
    const tokens = await exchangeCode(code, codeVerifier, this.callbackPort)
    return this.saveFromTokens(tokens)
  }

  // ── Auth method 3: Refresh Token ─────────────────────────────────────────

  async addByRefreshToken(refreshToken: string): Promise<MaskedAccount> {
    const tokens = await refreshTokens(refreshToken)
    return this.saveFromTokens(tokens)
  }

  // ── Delete ───────────────────────────────────────────────────────────────

  async remove(accountId: string): Promise<boolean> {
    const exists = this.data.accounts.some(a => a.id === accountId)
    if (!exists) return false

    const filtered = this.data.accounts.filter(a => a.id !== accountId)
    const activeId = this.data.activeAccountId === accountId
      ? (filtered[0]?.id ?? null)
      : this.data.activeAccountId

    this.data = { activeAccountId: activeId, accounts: filtered }
    await saveAccounts(this.data)

    // If active shifted, apply new key; if no accounts remain, clear credentials
    const active = getActiveAccount(this.data)
    if (active) {
      await applyAuthFile(active)
    } else if (filtered.length === 0) {
      await clearAuthFile()
    }
    return true
  }

  // ── Usage ────────────────────────────────────────────────────────────────

  async getUsage(accountId: string): Promise<AccountUsage> {
    const account = this.data.accounts.find(a => a.id === accountId)
    if (!account) throw new Error('Account not found')

    const result = await fetchUsage(account.accessToken, account.accountId, account.refreshToken)

    // If token was refreshed during usage check, persist updated tokens
    if (result.refreshed) {
      await this.updateTokens(accountId, result.refreshed)
    }

    return result.usage
  }

  // ── Refresh ──────────────────────────────────────────────────────────────

  async refreshAccount(accountId: string): Promise<MaskedAccount> {
    const account = this.data.accounts.find(a => a.id === accountId)
    if (!account) throw new Error('Account not found')

    const tokens = await refreshTokens(account.refreshToken)
    await this.updateTokens(accountId, tokens)

    const updated = this.data.accounts.find(a => a.id === accountId)!
    return this.toMasked(updated)
  }

  async refreshAll(): Promise<readonly RefreshResult[]> {
    const snapshot = [...this.data.accounts]
    const settled = await Promise.allSettled(
      snapshot.map(account =>
        this.refreshAccount(account.id).then(masked => ({
          id: account.id,
          email: account.email,
          success: true as const,
          account: masked,
        })),
      ),
    )

    return settled.map((result, i) => {
      const account = snapshot[i]!
      if (result.status === 'fulfilled') return result.value
      const error = result.reason instanceof Error ? result.reason.message : String(result.reason)
      return { id: account.id, email: account.email, success: false, error }
    })
  }

  // ── List ─────────────────────────────────────────────────────────────────

  list(): readonly MaskedAccount[] {
    return this.data.accounts.map(a => this.toMasked(a))
  }

  // ── Switch ───────────────────────────────────────────────────────────────

  async switchTo(accountId: string): Promise<boolean> {
    if (accountId === this.data.activeAccountId) return true

    const account = this.data.accounts.find(a => a.id === accountId)
    if (!account || account.disabled) return false

    this.data = { ...this.data, activeAccountId: accountId }
    await saveAccounts(this.data)
    await applyAuthFile(account)
    return true
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  hasAccounts(): boolean {
    return this.data.accounts.length > 0
  }

  getActiveAccount(): CodexAccount | null {
    return getActiveAccount(this.data)
  }

  async applyActiveKey(): Promise<void> {
    const active = getActiveAccount(this.data)
    if (active) {
      await applyAuthFile(active)
    }
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private async saveFromTokens(tokens: TokenResponse): Promise<MaskedAccount> {
    const info = extractAccountInfo(tokens.id_token)
    const now = new Date().toISOString()
    const expiredAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    // Deduplicate by accountId — update existing if found
    const existingIdx = this.data.accounts.findIndex(a => a.accountId === info.accountId)

    const account: CodexAccount = {
      id: existingIdx >= 0 ? this.data.accounts[existingIdx]!.id : generateAccountId(),
      email: info.email,
      accountId: info.accountId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token,
      planType: info.planType,
      expired: expiredAt,
      lastRefresh: now,
      disabled: false,
      createdAt: existingIdx >= 0 ? this.data.accounts[existingIdx]!.createdAt : now,
    }

    const accounts = existingIdx >= 0
      ? this.data.accounts.map((a, i) => (i === existingIdx ? account : a))
      : [...this.data.accounts, account]

    const isFirst = this.data.accounts.length === 0
    this.data = {
      activeAccountId: isFirst ? account.id : this.data.activeAccountId,
      accounts,
    }

    await saveAccounts(this.data)

    // First account or re-authed active account → apply key
    if (account.id === this.data.activeAccountId) {
      await applyAuthFile(account)
    }

    return this.toMasked(account)
  }

  private async importExistingCodexAuth(): Promise<boolean> {
    const snapshot = await readCodexAuthFile()
    const tokens = snapshot?.tokens
    const accessToken = typeof tokens?.access_token === 'string' ? tokens.access_token.trim() : ''
    const refreshToken = typeof tokens?.refresh_token === 'string' ? tokens.refresh_token.trim() : ''
    const idToken = typeof tokens?.id_token === 'string' ? tokens.id_token.trim() : ''
    const accountId = typeof tokens?.account_id === 'string' ? tokens.account_id.trim() : ''

    if (!accessToken || !refreshToken || !idToken || !accountId) {
      return false
    }

    try {
      const info = extractAccountInfo(idToken)
      const now = new Date().toISOString()
      const expired = this.readJwtExp(accessToken)
      const account: CodexAccount = {
        id: generateAccountId(),
        email: info.email,
        accountId,
        accessToken,
        refreshToken,
        idToken,
        planType: info.planType,
        expired: expired ? new Date(expired * 1000).toISOString() : now,
        lastRefresh: snapshot?.last_refresh?.trim() || now,
        disabled: false,
        createdAt: now,
      }

      this.data = { activeAccountId: account.id, accounts: [account] }
      await saveAccounts(this.data)
      await applyAuthFile(account)
      return true
    } catch {
      return false
    }
  }

  private async updateTokens(accountId: string, tokens: TokenResponse): Promise<void> {
    const expiredAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    const now = new Date().toISOString()

    const accounts = this.data.accounts.map(a =>
      a.id === accountId
        ? { ...a, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, idToken: tokens.id_token, expired: expiredAt, lastRefresh: now }
        : a,
    )

    this.data = { ...this.data, accounts }
    await saveAccounts(this.data)

    // If this is the active account, update auth.json too
    if (accountId === this.data.activeAccountId) {
      const updated = accounts.find(a => a.id === accountId)
      if (updated) await applyAuthFile(updated)
    }
  }

  private toMasked(account: CodexAccount): MaskedAccount {
    return {
      id: account.id,
      email: account.email,
      accountId: account.accountId,
      planType: account.planType,
      expired: account.expired,
      lastRefresh: account.lastRefresh,
      disabled: account.disabled,
      isActive: account.id === this.data.activeAccountId,
      createdAt: account.createdAt,
    }
  }

  private pruneExpiredStates(): void {
    const now = Date.now()
    for (const [key, val] of this.pendingStates) {
      if (now - val.createdAt > STATE_TTL_MS) {
        this.pendingStates.delete(key)
      }
    }
  }

  private readJwtExp(token: string): number | null {
    try {
      const payload = decodeJwtPayload(token)
      return typeof payload.exp === 'number' ? payload.exp : null
    } catch {
      return null
    }
  }
}
