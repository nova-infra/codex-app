import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { appPaths } from '@/paths'

export type SessionMeta = {
  readonly sessionId: string
  readonly userId: string
  readonly projectDir: string
  readonly alias?: string
  readonly createdAt: string
  readonly lastActiveAt: string
  readonly turnCount?: number
  readonly totalTokensUsed?: number
  readonly model?: string
}

type SessionsData = {
  readonly version?: number
  readonly sessions: readonly SessionMeta[]
}

async function readSessions(): Promise<readonly SessionMeta[]> {
  if (!existsSync(appPaths.sessions)) return []
  const raw = await readFile(appPaths.sessions, 'utf-8')
  const data = JSON.parse(raw) as SessionsData
  // v1 has no version field; v2+ has version: 2 — both shapes are compatible
  return data.sessions ?? []
}

async function writeSessions(sessions: readonly SessionMeta[]): Promise<void> {
  await writeFile(appPaths.sessions, JSON.stringify({ version: 2, sessions }, null, 2))
}

export class SessionStore {
  async save(meta: SessionMeta): Promise<void> {
    const existing = await readSessions()
    const filtered = existing.filter(s => s.sessionId !== meta.sessionId)
    await writeSessions([...filtered, meta])
  }

  async findByUser(userId: string): Promise<readonly SessionMeta[]> {
    const sessions = await readSessions()
    return sessions.filter(s => s.userId === userId)
  }

  async findByProject(userId: string, projectDir: string): Promise<readonly SessionMeta[]> {
    const sessions = await readSessions()
    return sessions.filter(s => s.userId === userId && s.projectDir === projectDir)
  }

  async findLatest(userId: string, projectDir: string): Promise<SessionMeta | null> {
    const sessions = await this.findByProject(userId, projectDir)
    if (sessions.length === 0) return null
    return [...sessions].sort(
      (a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
    )[0]
  }

  async updateLastActive(sessionId: string): Promise<void> {
    const sessions = await readSessions()
    const updated = sessions.map(s =>
      s.sessionId === sessionId
        ? { ...s, lastActiveAt: new Date().toISOString() }
        : s
    )
    await writeSessions(updated)
  }

  async remove(sessionId: string): Promise<void> {
    const sessions = await readSessions()
    await writeSessions(sessions.filter(s => s.sessionId !== sessionId))
  }

  async incrementTurn(sessionId: string, tokensUsed?: number): Promise<void> {
    const sessions = await readSessions()
    const updated = sessions.map(s => {
      if (s.sessionId !== sessionId) return s
      return {
        ...s,
        turnCount: (s.turnCount ?? 0) + 1,
        totalTokensUsed: tokensUsed !== undefined
          ? (s.totalTokensUsed ?? 0) + tokensUsed
          : s.totalTokensUsed,
      }
    })
    await writeSessions(updated)
  }
}
