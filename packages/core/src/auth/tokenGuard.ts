import type { TokenEntry } from '../config'

export class TokenGuard {
  private readonly tokenMap: ReadonlyMap<string, TokenEntry>

  constructor(tokens: readonly TokenEntry[]) {
    this.tokenMap = new Map(tokens.map(t => [t.token, t]))
  }

  verify(token: string | null | undefined): TokenEntry | null {
    if (!token) return null
    return this.tokenMap.get(token) ?? null
  }

  extractToken(url: URL): string | null {
    return url.searchParams.get('token')
  }
}
