import type { CodexClient } from '@/bridge/codexClient'
import { SessionStore, type SessionMeta } from '@/session/sessionStore'

type ThreadStartResult = {
  readonly threadId: string
}

export class SessionManager {
  private readonly store = new SessionStore()

  constructor(private readonly codex: CodexClient) {}

  async startSession(userId: string, projectDir: string, model?: string): Promise<SessionMeta> {
    const result = await this.codex.call('thread/start', {
      cwd: projectDir,
      ...(model ? { model } : {}),
    }) as ThreadStartResult

    const meta: SessionMeta = {
      sessionId: result.threadId,
      userId,
      projectDir,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    }

    this.store.save(meta)
    return meta
  }

  async resumeSession(sessionId: string, projectDir?: string): Promise<void> {
    await this.codex.call('thread/resume', {
      threadId: sessionId,
      ...(projectDir ? { cwd: projectDir } : {}),
    })
    this.store.updateLastActive(sessionId)
  }

  async getOrCreateSession(userId: string, projectDir: string): Promise<SessionMeta> {
    const latest = this.store.findLatest(userId, projectDir)
    if (latest) {
      await this.resumeSession(latest.sessionId, projectDir)
      return latest
    }
    return this.startSession(userId, projectDir)
  }

  listSessions(userId: string, projectDir?: string): readonly SessionMeta[] {
    if (projectDir) {
      return this.store.findByProject(userId, projectDir)
    }
    return this.store.findByUser(userId)
  }

  async archiveSession(sessionId: string): Promise<void> {
    await this.codex.call('thread/archive', { threadId: sessionId })
    this.store.remove(sessionId)
  }

  async compactSession(sessionId: string): Promise<void> {
    await this.codex.call('thread/compact/start', { threadId: sessionId })
  }

  touchSession(sessionId: string): void {
    this.store.updateLastActive(sessionId)
  }
}
