import type { CodexClient, CodexNotification } from '@/bridge/codexClient'

export type ChannelSink = {
  readonly type: 'ws' | 'telegram' | 'wechat'
  readonly id: string
  send(notification: CodexNotification): void
}

export class NotificationHub {
  private readonly sinks = new Map<string, Set<ChannelSink>>()
  private unsubscribe: (() => void) | null = null

  constructor(private readonly codex: CodexClient) {}

  start(): void {
    this.unsubscribe = this.codex.onNotification((n) => {
      this.dispatch(n)
    })
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  subscribe(sessionId: string, sink: ChannelSink): void {
    const set = this.sinks.get(sessionId) ?? new Set()
    set.add(sink)
    this.sinks.set(sessionId, set)
  }

  unsubscribeSink(sessionId: string, sink: ChannelSink): void {
    const set = this.sinks.get(sessionId)
    if (set) {
      set.delete(sink)
      if (set.size === 0) this.sinks.delete(sessionId)
    }
  }

  private dispatch(notification: CodexNotification): void {
    // Extract threadId from notification params if available
    const params = notification.params as Record<string, unknown> | null
    const threadId = typeof params?.threadId === 'string' ? params.threadId : null

    if (threadId) {
      const sinks = this.sinks.get(threadId)
      if (sinks) {
        for (const sink of sinks) {
          sink.send(notification)
        }
      }
      return
    }

    // Broadcast to all if no threadId
    for (const sinks of this.sinks.values()) {
      for (const sink of sinks) {
        sink.send(notification)
      }
    }
  }
}
