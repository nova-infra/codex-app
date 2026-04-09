import { createHash, randomBytes } from 'node:crypto'

export const AUTH_ENDPOINT = 'https://auth.openai.com/oauth/authorize'
export const TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token'
export const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const SCOPES = 'openid email profile offline_access'

export type TokenResponse = {
  readonly access_token: string
  readonly refresh_token: string
  readonly id_token: string
  readonly expires_in: number
}

function toBase64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export function generateCodeVerifier(): string {
  return toBase64Url(randomBytes(32))
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = createHash('sha256').update(verifier).digest()
  return toBase64Url(hash)
}

export function generateState(): string {
  return randomBytes(16).toString('hex')
}

export function buildAuthUrl(
  state: string,
  codeChallenge: string,
  callbackPort: number,
): string {
  const redirectUri = `http://localhost:${callbackPort}/codex-account/callback`
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })
  return `${AUTH_ENDPOINT}?${params.toString()}`
}

export async function exchangeCode(
  code: string,
  codeVerifier: string,
  callbackPort: number,
): Promise<TokenResponse> {
  const redirectUri = `http://localhost:${callbackPort}/codex-account/callback`
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }).toString(),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Token exchange failed [${res.status}]: ${body}`)
  }

  return res.json() as Promise<TokenResponse>
}

export async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      scope: 'openid profile email',
    }).toString(),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Token refresh failed [${res.status}]: ${body}`)
  }

  return res.json() as Promise<TokenResponse>
}
