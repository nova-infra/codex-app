/**
 * iLink getupdates long polling + QR login flow.
 * Session persistence in dataDir/wechat-session.json.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ILinkClient, type ILinkIncomingMessage } from '@/iLinkClient'

type WeChatSession = {
  botToken: string
  baseUrl: string
  lastUpdateCursor: string
  savedAt: string
}

type LoginState = 'idle' | 'qr_pending' | 'scanned' | 'confirmed' | 'active' | 'expired'

const DEFAULT_LONG_POLL_MS = 38_000
const MAX_POLL_FAILURES_BEFORE_BACKOFF = 3
const POLL_BACKOFF_MS = 30_000
const POLL_RETRY_MS = 2_000
const SESSION_EXPIRED_ERRCODE = -14

export type PollerCallbacks = {
  onMessage: (msg: ILinkIncomingMessage) => Promise<void>
  onQrUrl?: (url: string) => void
  onError?: (err: string) => void
}

export type PollerStatus = {
  loginState: LoginState
  qrCodeUrl: string
  lastError: string
  configured: boolean
}

export class ILinkPoller {
  readonly client = new ILinkClient()

  private active = false
  private loginState: LoginState = 'idle'
  private qrCodeUrl = ''
  private lastError = ''
  private lastUpdateCursor = ''
  private longPollTimeoutMs = DEFAULT_LONG_POLL_MS
  private pollConsecutiveFailures = 0

  constructor(
    private readonly dataDir: string,
    private readonly callbacks: PollerCallbacks,
  ) {}

  get status(): PollerStatus {
    return {
      loginState: this.loginState,
      qrCodeUrl: this.qrCodeUrl,
      lastError: this.lastError,
      configured: this.client.isConfigured,
    }
  }

  async start(): Promise<void> {
    if (this.active) return
    this.active = true
    const loaded = await this.loadSession()
    if (loaded && this.client.isConfigured) {
      this.loginState = 'active'
      void this.pollMessages()
    } else {
      void this.startQrLogin()
    }
  }

  stop(): void {
    this.active = false
    this.loginState = 'idle'
    this.qrCodeUrl = ''
    this.longPollTimeoutMs = DEFAULT_LONG_POLL_MS
    this.pollConsecutiveFailures = 0
  }

  private async loadSession(): Promise<boolean> {
    const path = this.getSessionPath()
    if (!existsSync(path)) return false
    try {
      const raw = JSON.parse(await readFile(path, 'utf8')) as Partial<WeChatSession>
      const botToken = typeof raw.botToken === 'string' ? raw.botToken.trim() : ''
      const baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : ''
      const cursor = typeof raw.lastUpdateCursor === 'string' ? raw.lastUpdateCursor : ''
      if (!botToken) return false
      this.client.configure(botToken, baseUrl || undefined)
      this.lastUpdateCursor = cursor
      return true
    } catch {
      return false
    }
  }

  async saveSession(): Promise<void> {
    const sessionDir = join(this.dataDir, 'wechat-sessions')
    if (!existsSync(sessionDir)) await mkdir(sessionDir, { recursive: true })
    const session: WeChatSession = {
      botToken: this.client.token,
      baseUrl: '',
      lastUpdateCursor: this.lastUpdateCursor,
      savedAt: new Date().toISOString(),
    }
    await writeFile(this.getSessionPath(), `${JSON.stringify(session, null, 2)}\n`, 'utf8')
  }

  private getSessionPath(): string {
    return join(this.dataDir, 'wechat-sessions', 'session.json')
  }

  private async startQrLogin(): Promise<void> {
    try {
      const result = await this.client.getQrCode()
      this.qrCodeUrl = result.qrcode_url
      this.loginState = 'qr_pending'
      this.callbacks.onQrUrl?.(result.qrcode_url)
      void this.pollQrStatus(result.qrcode)
    } catch (error) {
      this.qrCodeUrl = ''
      this.lastError = error instanceof Error ? error.message : 'Failed to get QR code'
      this.loginState = 'expired'
      this.callbacks.onError?.(this.lastError)
    }
  }

  private async pollQrStatus(qrcode: string): Promise<void> {
    while (this.active) {
      try {
        const status = await this.client.getQrCodeStatus(qrcode)
        if (status.status === 'scanned') {
          this.loginState = 'scanned'
        } else if (status.status === 'confirmed') {
          const botToken = typeof status.bot_token === 'string' ? status.bot_token.trim() : ''
          const baseUrl = typeof status.baseurl === 'string' ? status.baseurl.trim() : ''
          if (botToken) {
            this.qrCodeUrl = ''
            this.client.configure(botToken, baseUrl || undefined)
            this.loginState = 'confirmed'
            await this.saveSession()
            this.loginState = 'active'
            void this.pollMessages()
          }
          return
        } else if (status.status === 'expired') {
          this.loginState = 'expired'
          void this.startQrLogin()
          return
        }
        await this.sleep(2000)
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : 'QR status polling failed'
        await this.sleep(2000)
      }
    }
  }

  private async pollMessages(): Promise<void> {
    while (this.active) {
      try {
        const updates = await this.client.getUpdates(this.lastUpdateCursor, this.longPollTimeoutMs)

        if (
          typeof updates.longpolling_timeout_ms === 'number' &&
          Number.isFinite(updates.longpolling_timeout_ms) &&
          updates.longpolling_timeout_ms > 0
        ) {
          this.longPollTimeoutMs = updates.longpolling_timeout_ms
        }

        const ret = typeof updates.ret === 'number' ? updates.ret : 0
        const errcode = typeof updates.errcode === 'number' ? updates.errcode : undefined
        const isApiError = (updates.ret !== undefined && updates.ret !== 0) ||
          (errcode !== undefined && errcode !== 0)

        if (isApiError) {
          const expired = errcode === SESSION_EXPIRED_ERRCODE || ret === SESSION_EXPIRED_ERRCODE
          if (expired) {
            this.lastError = 'iLink session expired (-14); scan QR again'
            this.pollConsecutiveFailures = 0
            await this.sleepWhileActive(60 * 60_000)
            continue
          }
          this.pollConsecutiveFailures += 1
          this.lastError = `getUpdates error: ret=${String(updates.ret)} errcode=${String(errcode)}`
          await this.sleepWhileActive(
            this.pollConsecutiveFailures >= MAX_POLL_FAILURES_BEFORE_BACKOFF
              ? (this.pollConsecutiveFailures = 0, POLL_BACKOFF_MS)
              : POLL_RETRY_MS,
          )
          continue
        }

        this.pollConsecutiveFailures = 0
        this.lastError = ''

        const buf = updates.get_updates_buf
        if (buf != null && buf !== '') {
          this.lastUpdateCursor = buf
          void this.saveSession().catch(() => {})
        }

        const messages = Array.isArray(updates.msgs) && updates.msgs.length > 0
          ? updates.msgs
          : Array.isArray(updates.msg_list) ? updates.msg_list : []

        for (const msg of messages) {
          await this.callbacks.onMessage(msg)
        }
      } catch (error) {
        if (!this.active) return
        this.pollConsecutiveFailures += 1
        this.lastError = error instanceof Error ? error.message : 'WeChat message polling failed'
        this.callbacks.onError?.(this.lastError)
        await this.sleepWhileActive(
          this.pollConsecutiveFailures >= MAX_POLL_FAILURES_BEFORE_BACKOFF
            ? (this.pollConsecutiveFailures = 0, POLL_BACKOFF_MS)
            : POLL_RETRY_MS,
        )
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private async sleepWhileActive(totalMs: number): Promise<void> {
    const slice = 1000
    let left = totalMs
    while (this.active && left > 0) {
      const step = Math.min(slice, left)
      await this.sleep(step)
      left -= step
    }
  }
}
