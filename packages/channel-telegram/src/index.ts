import type { CodexClient, AppConfig } from '@codex-app/core'
import type { TokenGuard } from '@codex-app/core'
import { TelegramPoller } from '@/polling'
import { TelegramSender } from '@/sender'
import { TelegramAdapter } from '@/adapter'

export type TelegramChannelOptions = {
  readonly botToken: string
  readonly codex: CodexClient
  readonly tokenGuard: TokenGuard
  readonly config: AppConfig
}

export class TelegramChannel {
  private readonly poller: TelegramPoller
  private readonly sender: TelegramSender
  private readonly adapter: TelegramAdapter

  constructor(opts: TelegramChannelOptions) {
    this.sender = new TelegramSender(opts.botToken)
    this.adapter = new TelegramAdapter(opts.codex, this.sender, opts.tokenGuard, opts.config)
    this.poller = new TelegramPoller(opts.botToken)
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

export async function start(deps: {
  readonly codex: CodexClient
  readonly tokenGuard: TokenGuard
  readonly config: AppConfig
}): Promise<void> {
  const { config, codex, tokenGuard } = deps
  if (!config.telegram?.botToken) return
  const channel = new TelegramChannel({
    botToken: config.telegram.botToken,
    codex,
    tokenGuard,
    config,
  })
  channel.start()
  console.log(`[telegram] Polling started, bot token: ${config.telegram.botToken.slice(0, 8)}...`)
}
