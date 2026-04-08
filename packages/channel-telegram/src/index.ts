import type { CodexClient } from '@codex-app/core'
import type { TokenGuard } from '@codex-app/core'
import { TelegramPoller } from '@/polling'
import { TelegramSender } from '@/sender'
import { TelegramAdapter } from '@/adapter'

export type TelegramChannelOptions = {
  readonly botToken: string
  readonly codex: CodexClient
  readonly tokenGuard: TokenGuard
  readonly defaultCwd?: string
}

export class TelegramChannel {
  private readonly poller: TelegramPoller
  private readonly sender: TelegramSender
  private readonly adapter: TelegramAdapter

  constructor(opts: TelegramChannelOptions) {
    this.sender = new TelegramSender(opts.botToken)
    this.adapter = new TelegramAdapter(opts.codex, this.sender, opts.tokenGuard)
    this.poller = new TelegramPoller(opts.botToken)
    if (opts.defaultCwd) {
      this.adapter.defaultCwd = opts.defaultCwd
    }
  }

  start(): void {
    this.adapter.start()
    this.poller.start(update => this.adapter.handleUpdate(update))
  }

  stop(): void {
    this.poller.stop()
    this.adapter.stop()
  }

  get isActive(): boolean {
    return this.poller.isActive
  }

  get lastError(): string {
    return this.poller.lastError
  }
}

export type { TelegramUpdate } from '@/types'
export { TelegramPoller } from '@/polling'
export { TelegramSender } from '@/sender'
export { TelegramAdapter } from '@/adapter'
