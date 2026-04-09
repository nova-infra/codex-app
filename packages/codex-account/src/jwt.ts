/** Zero-dependency JWT payload decoder. No external libraries. */

const OPENAI_AUTH_NS = 'https://api.openai.com/auth'

function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '=='.slice(0, (4 - (base64.length % 4)) % 4)
  return Buffer.from(padded, 'base64').toString('utf-8')
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.')
  if (parts.length < 2 || !parts[1]) {
    throw new Error('Invalid JWT: expected header.payload.signature')
  }
  try {
    return JSON.parse(base64UrlDecode(parts[1])) as Record<string, unknown>
  } catch (err) {
    throw new Error(`JWT decode failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export type AccountInfo = {
  readonly email: string
  readonly accountId: string
  readonly planType: string
  readonly userId: string
  readonly subscriptionUntil?: string
}

export function extractAccountInfo(idToken: string): AccountInfo {
  const payload = decodeJwtPayload(idToken)
  const ns = payload[OPENAI_AUTH_NS] as Record<string, unknown> | undefined

  const email = String(ns?.['email'] ?? payload['email'] ?? '')
  const accountId = String(ns?.['chatgpt_account_id'] ?? payload['sub'] ?? '')
  const planType = String(ns?.['chatgpt_plan_type'] ?? 'free')
  const userId = String(ns?.['chatgpt_user_id'] ?? payload['sub'] ?? '')
  const subscriptionUntil = ns?.['chatgpt_subscription_active_until'] != null
    ? String(ns['chatgpt_subscription_active_until'])
    : undefined

  if (!email) throw new Error('JWT missing email claim')
  if (!accountId) throw new Error('JWT missing chatgpt_account_id claim')
  if (!userId) throw new Error('JWT missing chatgpt_user_id claim')

  return { email, accountId, planType, userId, subscriptionUntil }
}
