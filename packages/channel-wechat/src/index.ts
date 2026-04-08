/**
 * @codex-app/channel-wechat
 * WechatChannel: composites ILinkPoller + WechatSender + WechatAdapter.
 */

import type { CodexClient, AppConfig } from '@codex-app/core'
import { appPaths } from '@codex-app/core'
import { ILinkPoller, type PollerStatus } from '@/polling'
import { WechatSender } from '@/sender'
import { WechatAdapter } from '@/adapter'

export type { PollerStatus } from '@/polling'

const DEFAULT_CDN_BASE = 'https://novac2c.cdn.weixin.qq.com/c2c'

export class WechatChannel {
  private readonly poller: ILinkPoller
  private readonly sender: WechatSender
  private readonly adapter: WechatAdapter
  private started = false

  constructor(codex: CodexClient, config: AppConfig, dataDir = appPaths.root) {
    // Poller owns the ILinkClient; sender shares it via poller.client
    this.poller = new ILinkPoller(dataDir, {
      onMessage: async (msg) => this.adapter.handleMessage(msg),
      onQrUrl: (url) => process.stdout.write(`[WeChat] QR code URL: ${url}\n`),
      onError: (err) => process.stderr.write(`[WeChat] Error: ${err}\n`),
    })
    this.sender = new WechatSender(this.poller.client, DEFAULT_CDN_BASE)
    this.adapter = new WechatAdapter(codex, this.sender, config)
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    this.adapter.start()
    await this.poller.start()
  }

  stop(): void {
    this.started = false
    this.poller.stop()
    this.adapter.stop()
  }

  get status(): PollerStatus {
    return this.poller.status
  }
}

export { ILinkClient } from '@/iLinkClient'
export { WechatSender } from '@/sender'
export { WechatAdapter } from '@/adapter'
export { ILinkPoller } from '@/polling'

export async function start(deps: {
  readonly codex: CodexClient
  readonly config: AppConfig
}): Promise<void> {
  const channel = new WechatChannel(deps.codex, deps.config)
  await channel.start()
}
