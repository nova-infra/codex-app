import type { CodexClient } from '@/bridge/codexClient'
import { SessionControlService } from '@/session/sessionControlService'

export type JsonRpcRequest = {
  readonly id?: number | string | null
  readonly method: string
  readonly params?: Record<string, unknown>
}

const ALLOWED_METHODS = new Set([
  'thread/list',
  'thread/start',
  'thread/resume',
  'thread/read',
  'thread/archive',
  'thread/compact/start',
  'turn/start',
  'turn/interrupt',
  'turn/steer',
  'model/list',
  'approval/respond',
])

export class ContractRouter {
  constructor(
    private readonly codex: CodexClient,
    private readonly sessions: SessionControlService,
  ) {}

  async route(userId: string, request: JsonRpcRequest): Promise<unknown> {
    if (!ALLOWED_METHODS.has(request.method)) {
      throw new Error(`Method not allowed: ${request.method}`)
    }

    switch (request.method) {
      case 'thread/list': {
        const limit = typeof request.params?.limit === 'number' ? request.params.limit : 20
        return { data: await this.sessions.listOwnedThreads(userId, limit) }
      }
      case 'thread/start': {
        const cwd = typeof request.params?.cwd === 'string' ? request.params.cwd : process.cwd()
        const model = typeof request.params?.model === 'string' ? request.params.model : undefined
        return this.sessions.startThread(userId, cwd, model)
      }
      case 'thread/resume': {
        const threadId = this.requireThreadId(request.params)
        const cwd = typeof request.params?.cwd === 'string' ? request.params.cwd : undefined
        await this.sessions.resumeThread(userId, threadId, cwd)
        return { ok: true, threadId }
      }
      case 'thread/read': {
        const threadId = this.requireThreadId(request.params)
        await this.sessions.assertOwnership(userId, threadId)
        return this.codex.call('thread/read', request.params ?? {})
      }
      case 'thread/archive': {
        const threadId = this.requireThreadId(request.params)
        await this.sessions.archiveThread(userId, threadId)
        return { ok: true, threadId }
      }
      case 'thread/compact/start': {
        const threadId = this.requireThreadId(request.params)
        await this.sessions.compactThread(userId, threadId)
        return { ok: true, threadId }
      }
      case 'turn/start': {
        const threadId = this.requireThreadId(request.params)
        await this.sessions.assertOwnership(userId, threadId)
        const result = await this.codex.call('turn/start', request.params ?? {})
        await this.sessions.touchThread(threadId)
        return result
      }
      case 'turn/interrupt':
      case 'turn/steer': {
        const threadId = this.requireThreadId(request.params)
        await this.sessions.assertOwnership(userId, threadId)
        return this.codex.call(request.method, request.params ?? {})
      }
      case 'model/list':
        return this.codex.call('model/list', request.params ?? {})
      case 'approval/respond': {
        const requestId = typeof request.params?.requestId === 'number' ? request.params.requestId : null
        const approved = Boolean(request.params?.approved)
        if (requestId === null) throw new Error('approval/respond requires requestId')
        await this.sessions.replyApproval(requestId, approved)
        return { ok: true, requestId, approved }
      }
      default:
        throw new Error(`Unhandled method: ${request.method}`)
    }
  }

  private requireThreadId(params: Record<string, unknown> | undefined): string {
    const threadId = typeof params?.threadId === 'string' ? params.threadId.trim() : ''
    if (!threadId) throw new Error('threadId is required')
    return threadId
  }
}
