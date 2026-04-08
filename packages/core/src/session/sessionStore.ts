import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getConfigDir } from '@/config'

export type SessionMeta = {
  readonly sessionId: string
  readonly token: string
  readonly projectDir: string
  readonly alias?: string
  readonly createdAt: string
  readonly lastActiveAt: string
}

type SessionsData = {
  readonly sessions: readonly SessionMeta[]
}

const SESSIONS_PATH = join(getConfigDir(), 'sessions.json')

function readSessions(): readonly SessionMeta[] {
  if (!existsSync(SESSIONS_PATH)) return []
  const raw = readFileSync(SESSIONS_PATH, 'utf-8')
  const data = JSON.parse(raw) as SessionsData
  return data.sessions ?? []
}

function writeSessions(sessions: readonly SessionMeta[]): void {
  writeFileSync(SESSIONS_PATH, JSON.stringify({ sessions }, null, 2))
}

export class SessionStore {
  save(meta: SessionMeta): void {
    const existing = readSessions()
    const filtered = existing.filter(s => s.sessionId !== meta.sessionId)
    writeSessions([...filtered, meta])
  }

  findByToken(token: string): readonly SessionMeta[] {
    return readSessions().filter(s => s.token === token)
  }

  findByProject(token: string, projectDir: string): readonly SessionMeta[] {
    return readSessions().filter(
      s => s.token === token && s.projectDir === projectDir
    )
  }

  findLatest(token: string, projectDir: string): SessionMeta | null {
    const sessions = this.findByProject(token, projectDir)
    if (sessions.length === 0) return null
    return [...sessions].sort(
      (a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
    )[0]
  }

  updateLastActive(sessionId: string): void {
    const sessions = readSessions()
    const updated = sessions.map(s =>
      s.sessionId === sessionId
        ? { ...s, lastActiveAt: new Date().toISOString() }
        : s
    )
    writeSessions(updated)
  }

  remove(sessionId: string): void {
    const sessions = readSessions()
    writeSessions(sessions.filter(s => s.sessionId !== sessionId))
  }
}
