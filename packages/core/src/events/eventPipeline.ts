import type { CodexClient, CodexNotification } from '@/bridge/codexClient'
import { SessionControlService } from '@/session/sessionControlService'
import { SessionPolicyEngine, type SessionPolicyDecision } from '@/session/sessionPolicyEngine'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function extractThreadId(params: unknown): string | null {
  const record = asRecord(params)
  if (!record) return null
  if (typeof record.threadId === 'string' && record.threadId.trim()) return record.threadId.trim()
  if (typeof record.thread_id === 'string' && record.thread_id.trim()) return record.thread_id.trim()
  const thread = asRecord(record.thread)
  if (typeof thread?.id === 'string' && thread.id.trim()) return thread.id.trim()
  const turn = asRecord(record.turn)
  if (typeof turn?.threadId === 'string' && turn.threadId.trim()) return turn.threadId.trim()
  if (typeof turn?.thread_id === 'string' && turn.thread_id.trim()) return turn.thread_id.trim()
  return null
}

function extractApprovalRequestId(params: unknown): number | null {
  const record = asRecord(params)
  if (!record) return null
  if (typeof record._requestId === 'number') return record._requestId
  if (typeof record.id === 'number') return record.id
  return null
}

function extractTokenUsage(params: unknown): { used: number; total: number } | null {
  const tokenUsage = asRecord(asRecord(params)?.tokenUsage)
  const used = typeof tokenUsage?.used === 'number' ? tokenUsage.used : 0
  const total = typeof tokenUsage?.total === 'number' ? tokenUsage.total : 0
  if (!total) return null
  return { used, total }
}

export type RuntimeEventKind =
  | 'raw'
  | 'approval_request'
  | 'assistant_delta'
  | 'tool_started'
  | 'tool_completed'
  | 'turn_completed'
  | 'error'
  | 'context_usage'

export type RuntimeEvent = {
  readonly kind: RuntimeEventKind
  readonly threadId: string | null
  readonly method: string
  readonly requestId?: number
  readonly policyDecision?: SessionPolicyDecision
  readonly raw: CodexNotification
}

export class EventPipeline {
  private readonly listeners = new Set<(event: RuntimeEvent) => void>()
  private unsubscribe: (() => void) | null = null

  constructor(
    private readonly codex: CodexClient,
    private readonly sessionControl: SessionControlService,
    private readonly policyEngine: SessionPolicyEngine,
  ) {}

  start(): void {
    this.unsubscribe?.()
    this.unsubscribe = this.codex.onNotification(notification => {
      void this.dispatch(notification)
    })
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  onEvent(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async dispatch(notification: CodexNotification): Promise<void> {
    const threadId = extractThreadId(notification.params)
    const requestId = extractApprovalRequestId(notification.params)
    const usage = extractTokenUsage(notification.params)
    const policyDecision = usage
      ? this.policyEngine.evaluateTokenUsage(usage.used, usage.total)
      : undefined

    if (threadId && policyDecision?.kind === 'auto_compact') {
      const ownerId = await this.sessionControl.findSessionOwner(threadId).catch(() => null)
      if (ownerId) {
        await this.sessionControl.compactThread(ownerId, threadId).catch(() => {})
      }
    }

    if (threadId && notification.method === 'turn/completed') {
      await this.sessionControl.touchThread(threadId, usage?.used).catch(() => {})
    }

    const kind = notification.method.endsWith('Approval')
      ? 'approval_request'
      : notification.method === 'item/agentMessage/delta'
        ? 'assistant_delta'
        : notification.method === 'item/started'
          ? 'tool_started'
          : notification.method === 'item/completed'
            ? 'tool_completed'
            : notification.method === 'turn/completed'
              ? 'turn_completed'
              : notification.method === 'error'
                ? 'error'
                : notification.method === 'thread/tokenUsage/updated'
                  ? 'context_usage'
                  : 'raw'

    const event: RuntimeEvent = {
      kind,
      threadId,
      method: notification.method,
      requestId: requestId ?? undefined,
      policyDecision,
      raw: notification,
    }

    for (const listener of this.listeners) {
      listener(event)
    }
  }
}
