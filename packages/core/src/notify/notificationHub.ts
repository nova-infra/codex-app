import type { EventPipeline, RuntimeEvent } from '@/events/eventPipeline'

export type ChannelSink = {
  readonly type: 'ws' | 'telegram' | 'wechat'
  readonly id: string
  send(event: RuntimeEvent): void
}

export class NotificationHub {
  private readonly sinks = new Map<string, Set<ChannelSink>>()
  private unsubscribe: (() => void) | null = null

  constructor(private readonly events: EventPipeline) {}

  start(): void {
    this.unsubscribe = this.events.onEvent((event) => {
      this.dispatch(event)
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

  private dispatch(event: RuntimeEvent): void {
    if (!event.threadId) return
    const sinks = this.sinks.get(event.threadId)
    if (!sinks) return
    for (const sink of sinks) {
      sink.send(event)
    }
  }
}
