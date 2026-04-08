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

    await this.store.save(meta)
    return meta
  }

  async resumeSession(sessionId: string, projectDir?: string): Promise<void> {
    await this.codex.call('thread/resume', {
      threadId: sessionId,
      ...(projectDir ? { cwd: projectDir } : {}),
    })
    await this.store.updateLastActive(sessionId)
  }

  async getOrCreateSession(userId: string, projectDir: string): Promise<SessionMeta> {
    const latest = await this.store.findLatest(userId, projectDir)
    if (latest) {
      await this.resumeSession(latest.sessionId, projectDir)
      return latest
    }
    return this.startSession(userId, projectDir)
  }

  async listSessions(userId: string, projectDir?: string): Promise<readonly SessionMeta[]> {
    if (projectDir) {
      return await this.store.findByProject(userId, projectDir)
    }
    return await this.store.findByUser(userId)
  }

  async archiveSession(sessionId: string): Promise<void> {
    await this.codex.call('thread/archive', { threadId: sessionId })
    await this.store.remove(sessionId)
  }

  async compactSession(sessionId: string): Promise<void> {
    await this.codex.call('thread/compact/start', { threadId: sessionId })
  }

  async touchSession(sessionId: string): Promise<void> {
    await this.store.updateLastActive(sessionId)
  }

  /**
   * Register a session that was created externally (e.g. via transparent WS proxy).
   * Saves the session meta without calling codex again.
   */
  async registerSession(userId: string, sessionId: string, projectDir: string): Promise<void> {
    const meta: SessionMeta = {
      sessionId,
      userId,
      projectDir,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    }
    await this.store.save(meta)
  }
}
