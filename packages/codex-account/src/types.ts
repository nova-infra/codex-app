export type CodexAccount = {
  readonly id: string
  readonly email: string
  readonly accountId: string
  readonly accessToken: string
  readonly refreshToken: string
  readonly idToken?: string
  readonly planType: string
  readonly expired: string
  readonly lastRefresh: string
  readonly disabled: boolean
  readonly createdAt: string
}

export type AccountData = {
  readonly activeAccountId: string | null
  readonly accounts: readonly CodexAccount[]
}

export type MaskedAccount = {
  readonly id: string
  readonly email: string
  readonly accountId: string
  readonly planType: string
  readonly expired: string
  readonly lastRefresh: string
  readonly disabled: boolean
  readonly isActive: boolean
  readonly createdAt: string
}

export type UsageWindow = {
  readonly usedPercent: number
  readonly resetAt: string
}

export type AccountUsage = {
  readonly session3h: UsageWindow
  readonly weekly: UsageWindow
  readonly limitReached: boolean
}

export type OAuthState = {
  readonly state: string
  readonly codeVerifier: string
  readonly createdAt: number
}

export type RefreshResult = {
  readonly id: string
  readonly email: string
  readonly success: boolean
  readonly account?: MaskedAccount
  readonly error?: string
}
