import type { AccountUsage } from './types'
import { refreshTokens } from './oauth'
import type { TokenResponse } from './oauth'

const USAGE_ENDPOINT = 'https://chatgpt.com/backend-api/wham/usage'

type RawUsageQuota = {
  used_percent: number
  reset_at: string
}

type RawUsageResponse = {
  session_3h?: RawUsageQuota
  weekly?: RawUsageQuota
  limit_reached?: boolean
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

  const usage: AccountUsage = {
    session3h: {
      usedPercent: raw.session_3h?.used_percent ?? 0,
      resetAt: raw.session_3h?.reset_at ?? '',
    },
    weekly: {
      usedPercent: raw.weekly?.used_percent ?? 0,
      resetAt: raw.weekly?.reset_at ?? '',
    },
    limitReached: raw.limit_reached ?? false,
  }

  return { usage, refreshed }
}
