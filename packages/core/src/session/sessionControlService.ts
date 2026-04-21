import type { CodexClient } from '@/bridge/codexClient'
import {
  JsonBindingStorageAdapter,
  JsonSessionStorageAdapter,
  type BindingStorageAdapter,
  type SessionStorageAdapter,
} from '@/store/storageAdapter'
import type { ChannelType } from '@/store/bindingStore'
import type { SessionMeta } from '@/session/sessionStore'

type ThreadReadPayload = {
  readonly thread?: {
    readonly id?: string
    readonly cwd?: string
  }
  readonly threadId?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function extractThreadId(payload: unknown): string {
  const result = asRecord(payload)
  const thread = asRecord(result?.thread)
  if (typeof result?.threadId === 'string' && result.threadId.trim()) return result.threadId.trim()
  if (typeof thread?.id === 'string' && thread.id.trim()) return thread.id.trim()
  return ''
}

export type ThreadSummary = {
  readonly id: string
  readonly name: string
  readonly cwd: string
  readonly createdAt?: string
  readonly updatedAt?: string
}

export class SessionControlService {
  constructor(
    private readonly codex: CodexClient,
    private readonly sessionStorage: SessionStorageAdapter = new JsonSessionStorageAdapter(),
    private readonly bindingStorage: BindingStorageAdapter = new JsonBindingStorageAdapter(),
  ) {}

  async startThread(userId: string, projectDir: string, model?: string): Promise<{ threadId: string }> {
    const result = await this.codex.call('thread/start', {
      cwd: projectDir,
      ...(model ? { model } : {}),
    })
    const threadId = extractThreadId(result)
    if (!threadId) throw new Error('thread/start did not return thread id')
    await this.registerSession(userId, threadId, projectDir, model)
    return { threadId }
  }

  async resumeThread(userId: string, threadId: string, projectDir?: string): Promise<void> {
    await this.assertOwnership(userId, threadId)
    await this.codex.call('thread/resume', {
      threadId,
      ...(projectDir ? { cwd: projectDir } : {}),
    })
    await this.sessionStorage.updateLastActive(threadId)
  }

  async compactThread(userId: string, threadId: string): Promise<void> {
    await this.assertOwnership(userId, threadId)
    await this.codex.call('thread/compact/start', { threadId })
  }

  async archiveThread(userId: string, threadId: string): Promise<void> {
    await this.assertOwnership(userId, threadId)
    await this.codex.call('thread/archive', { threadId })
    await this.sessionStorage.remove(threadId)
  }

  async touchThread(threadId: string, tokensUsed?: number): Promise<void> {
    await this.sessionStorage.updateLastActive(threadId)
    if (tokensUsed !== undefined) {
      await this.sessionStorage.incrementTurn(threadId, tokensUsed)
    }
  }

  async registerSession(userId: string, sessionId: string, projectDir: string, model?: string): Promise<void> {
    const meta: SessionMeta = {
      sessionId,
      userId,
      projectDir,
      model,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    }
    await this.sessionStorage.save(meta)
  }

  async findSession(sessionId: string): Promise<SessionMeta | null> {
    return this.sessionStorage.findById(sessionId)
  }

  async findSessionOwner(threadId: string): Promise<string | null> {
    const session = await this.findSession(threadId)
    return session?.userId ?? null
  }

  async ownsThread(userId: string, threadId: string): Promise<boolean> {
    const meta = await this.sessionStorage.findById(threadId)
    return meta?.userId === userId
  }

  async assertOwnership(userId: string, threadId: string): Promise<void> {
    const owns = await this.ownsThread(userId, threadId)
    if (!owns) throw new Error('Forbidden: session not owned by this user')
  }

  async listOwnedThreads(userId: string, limit = 20): Promise<readonly ThreadSummary[]> {
    const owned = await this.sessionStorage.findByUser(userId)
    if (!owned.length) return []

    const allowed = new Map(owned.map(meta => [meta.sessionId, meta]))
    const payload = asRecord(await this.codex.call('thread/list', {
      archived: false,
      limit: Math.max(limit, owned.length),
      sortKey: 'updated_at',
    }))
    const rows = Array.isArray(payload?.data) ? payload.data : []
    const summaries: ThreadSummary[] = []

    for (const row of rows) {
      const record = asRecord(row)
      const id = typeof record?.id === 'string' ? record.id.trim() : ''
      if (!id || !allowed.has(id)) continue
      const meta = allowed.get(id)
      const name = typeof record?.name === 'string'
        ? record.name
        : typeof record?.preview === 'string'
          ? record.preview
          : id
      const cwd = typeof record?.cwd === 'string' ? record.cwd.trim() : meta?.projectDir ?? ''
      summaries.push({
        id,
        name,
        cwd,
        createdAt: meta?.createdAt,
        updatedAt: meta?.lastActiveAt,
      })
    }

    if (summaries.length > 0) return summaries.slice(0, limit)

    return owned
      .slice()
      .sort((a, b) => Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt))
      .slice(0, limit)
      .map(meta => ({
        id: meta.sessionId,
        name: meta.alias ?? meta.sessionId,
        cwd: meta.projectDir,
        createdAt: meta.createdAt,
        updatedAt: meta.lastActiveAt,
      }))
  }

  async readThreadCwd(userId: string, threadId: string): Promise<string> {
    await this.assertOwnership(userId, threadId)
    return this.readThreadCwdUnsafe(threadId)
  }

  async readThreadCwdUnsafe(threadId: string): Promise<string> {
    try {
      const response = await this.codex.call('thread/read', { threadId, includeTurns: false }) as ThreadReadPayload
      return typeof response.thread?.cwd === 'string' ? response.thread.cwd.trim() : ''
    } catch {
      return ''
    }
  }

  async ensureChannelThread(
    type: ChannelType,
    externalId: string,
    userId: string,
    options: { readonly projectDir: string; readonly model?: string },
  ): Promise<string> {
    const binding = await this.bindingStorage.find(type, externalId)
    const threadId = binding?.threadId
    if (threadId && await this.ownsThread(userId, threadId)) {
      await this.resumeThread(userId, threadId, options.projectDir)
      return threadId
    }
    const started = await this.startThread(userId, options.projectDir, options.model)
    await this.bindingStorage.update(type, externalId, { threadId: started.threadId })
    return started.threadId
  }

  async createChannelThread(
    type: ChannelType,
    externalId: string,
    userId: string,
    options: { readonly projectDir: string; readonly model?: string },
  ): Promise<string> {
    const started = await this.startThread(userId, options.projectDir, options.model)
    await this.bindingStorage.update(type, externalId, { threadId: started.threadId })
    return started.threadId
  }

  async switchChannelThread(
    type: ChannelType,
    externalId: string,
    userId: string,
    threadId: string,
  ): Promise<void> {
    await this.assertOwnership(userId, threadId)
    await this.bindingStorage.update(type, externalId, { threadId })
    await this.sessionStorage.updateLastActive(threadId)
  }

  async getBindingThread(type: ChannelType, externalId: string): Promise<string | null> {
    const binding = await this.bindingStorage.find(type, externalId)
    return binding?.threadId ?? null
  }

  async replyApproval(requestId: number, approved: boolean): Promise<void> {
    this.codex.reply(requestId, { approved })
  }
}
