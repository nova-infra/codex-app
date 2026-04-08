import type { TokenEntry, UserEntry } from '@/config'

export type AuthResult = {
  readonly userId: string
  readonly userName: string
  readonly tokenLabel?: string
}

export class TokenGuard {
  private readonly tokenMap: ReadonlyMap<string, TokenEntry>
  private readonly userMap: ReadonlyMap<string, UserEntry>

  constructor(users: readonly UserEntry[], tokens: readonly TokenEntry[]) {
    this.userMap = new Map(users.map(u => [u.id, u]))
    this.tokenMap = new Map(tokens.map(t => [t.token, t]))
  }

  verify(token: string | null | undefined): AuthResult | null {
    if (!token) return null
    const entry = this.tokenMap.get(token)
    if (!entry) return null
    const user = this.userMap.get(entry.userId)
    if (!user) return null
    return {
      userId: user.id,
      userName: user.name,
      tokenLabel: entry.label,
    }
  }

  resolveUserId(token: string): string | null {
    const entry = this.tokenMap.get(token)
    return entry?.userId ?? null
  }
}
