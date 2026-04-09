import type { AccountUsage } from './types'
import { refreshTokens } from './oauth'
import type { TokenResponse } from './oauth'

const USAGE_ENDPOINT = 'https://chatgpt.com/backend-api/wham/usage'

type RawUsageQuota = {
  used_percent: number
  reset_at?: string | number
  reset_after_seconds?: number
  limit_window_seconds?: number
}

type RawUsageResponse = {
  session_3h?: RawUsageQuota
  weekly?: RawUsageQuota
  limit_reached?: boolean
  rate_limit?: {
    allowed?: boolean
    limit_reached?: boolean
    primary_window?: RawUsageQuota
    secondary_window?: RawUsageQuota
  }
  spend_control?: {
    reached?: boolean
  }
  credits?: {
    overage_limit_reached?: boolean
  }
}

export type FetchUsageResult = {
  readonly usage: AccountUsage
  /** Updated token if a refresh occurred, otherwise undefined */
  readonly refreshed?: TokenResponse
}

function parseJwtExp(token: string): number | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf-8')) as Record<string, unknown>
    return typeof payload['exp'] === 'number' ? payload['exp'] : null
  } catch {
    return null
  }
}

function isExpired(token: string): boolean {
  const exp = parseJwtExp(token)
  if (exp === null) return true
  // Refresh 60s early to avoid clock-skew failures
  return Date.now() >= (exp - 60) * 1000
}

function toResetAt(value: string | number | undefined): string {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value
    return new Date(ms).toISOString()
  }
  return typeof value === 'string' ? value : ''
}

export async function fetchUsage(
  accessToken: string,
  accountId: string,
  refreshToken?: string,
): Promise<FetchUsageResult> {
  let token = accessToken
  let refreshed: TokenResponse | undefined

  if (isExpired(token)) {
    if (!refreshToken) {
      throw new Error('Access token expired and no refresh token available')
    }
    refreshed = await refreshTokens(refreshToken)
    token = refreshed.access_token
  }

  const res = await fetch(USAGE_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${token}`,
      'ChatGPT-Account-Id': accountId,
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Usage fetch failed [${res.status}]: ${body}`)
  }

  const raw = (await res.json()) as RawUsageResponse
  const primaryWindow = raw.rate_limit?.primary_window ?? raw.session_3h
  const secondaryWindow = raw.rate_limit?.secondary_window ?? raw.weekly
  const limitReached = raw.rate_limit?.limit_reached ??
    raw.spend_control?.reached ??
    raw.credits?.overage_limit_reached ??
    raw.limit_reached ??
    false

  const usage: AccountUsage = {
    session5h: {
      usedPercent: primaryWindow?.used_percent ?? 0,
      resetAt: toResetAt(primaryWindow?.reset_at),
    },
    weekly: {
      usedPercent: secondaryWindow?.used_percent ?? 0,
      resetAt: toResetAt(secondaryWindow?.reset_at),
    },
    limitReached,
  }

  return { usage, refreshed }
}
