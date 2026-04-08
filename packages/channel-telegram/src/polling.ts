import type { TelegramUpdate } from '@/types'

const POLL_TIMEOUT_SEC = 45
const RETRY_DELAY_MS = 1500
const MAX_FAILURES = 10

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

export class TelegramPoller {
  private offset = 0
  private active = false
  private failures = 0
  lastError = ''

  constructor(private readonly token: string) {}

  start(onUpdate: (u: TelegramUpdate) => Promise<void>): void {
    if (this.active) return
    this.active = true
    this.failures = 0
    void this.loop(onUpdate)
  }

  stop(): void {
    this.active = false
  }

  get isActive(): boolean {
    return this.active
  }

  private async loop(onUpdate: (u: TelegramUpdate) => Promise<void>): Promise<void> {
    while (this.active) {
      try {
        const updates = await this.fetchUpdates()
        this.lastError = ''
        this.failures = 0
        for (const update of updates) {
          const id = typeof update.update_id === 'number' ? update.update_id : -1
          if (id >= 0) this.offset = Math.max(this.offset, id + 1)
          await onUpdate(update)
        }
      } catch (err) {
        this.failures++
        this.lastError = err instanceof Error ? err.message : 'polling failed'
        if (this.failures > MAX_FAILURES) {
          this.active = false
          break
        }
        await new Promise<void>(r => setTimeout(r, RETRY_DELAY_MS))
      }
    }
  }

  private async fetchUpdates(): Promise<TelegramUpdate[]> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/getUpdates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeout: POLL_TIMEOUT_SEC,
        offset: this.offset,
        allowed_updates: ['message', 'callback_query'],
      }),
    })
    const payload = asRecord(await res.json())
    return Array.isArray(payload?.result) ? (payload.result as TelegramUpdate[]) : []
  }
}
