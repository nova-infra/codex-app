export type ChatQueueConfig = {
  readonly maxQueueSize: number
  readonly bypassCommands: readonly string[]
}

const DEFAULTS: ChatQueueConfig = {
  maxQueueSize: 5,
  bypassCommands: ['/status', '/help', '/model', '/reasoning', '/session'],
}

export class ChatQueue {
  private readonly cfg: ChatQueueConfig
  private readonly chains = new Map<string, Promise<void>>()
  private readonly pending = new Map<string, number>()

  constructor(config?: Partial<ChatQueueConfig>) {
    this.cfg = { ...DEFAULTS, ...config }
  }

  async enqueue<T>(chatId: string, handler: () => Promise<T>): Promise<T> {
    const count = this.pending.get(chatId) ?? 0
    if (count >= this.cfg.maxQueueSize) {
      throw new Error('queue_full')
    }
    this.pending.set(chatId, count + 1)

    const prev = this.chains.get(chatId) ?? Promise.resolve()

    return new Promise<T>((resolve, reject) => {
      const next = prev.then(async () => {
        try {
          const result = await handler()
          resolve(result)
        } catch (err) {
          reject(err)
        } finally {
          const remaining = (this.pending.get(chatId) ?? 1) - 1
          if (remaining <= 0) {
            this.pending.delete(chatId)
            this.chains.delete(chatId)
          } else {
            this.pending.set(chatId, remaining)
          }
        }
      })
      this.chains.set(chatId, next.then(() => {}, () => {}))
    })
  }

  isBypass(text: string): boolean {
    const cmd = text.trim().split(/\s/)[0]?.toLowerCase() ?? ''
    return this.cfg.bypassCommands.includes(cmd)
  }

  isBusy(chatId: string): boolean {
    return this.chains.has(chatId)
  }

  queueSize(chatId: string): number {
    return this.pending.get(chatId) ?? 0
  }
}
