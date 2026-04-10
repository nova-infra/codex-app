/**
 * iLink message sender: text chunking, image CDN upload, typing indicators.
 */

import { randomBytes, createHash } from 'node:crypto'
import { ILinkClient, type ILinkCdnMedia } from '@/iLinkClient'
import { buildWeChatSummaryFromFormatted, formatAssistantTextForWeChat, splitWeChatTextSegments } from '@/textFormat'
import { uploadWeChatCdnEncrypted } from '@/cdnCrypto'

const ASSISTANT_TEXT_CHUNK = 4000
const TYPING_TICKET_TTL_MS = 24 * 60 * 60 * 1000

type TicketEntry = { ticket: string; at: number }

export class WechatSender {
  private readonly typingTickets = new Map<string, TicketEntry>()
  private readonly typingTimers = new Map<string, ReturnType<typeof setInterval>>()
  private lastError = ''

  constructor(
    private readonly client: ILinkClient,
    private readonly cdnBaseUrl: string,
  ) {}

  get error(): string {
    return this.lastError
  }

  async sendText(chatId: string, contextToken: string, text: string): Promise<void> {
    const message = text.trim()
    if (!message) return
    try {
      await this.client.sendText(chatId, contextToken, message)
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Failed to send WeChat message'
      throw error
    }
  }

  /** Markdown cleanup + 4000-char chunking (wechat-acp bridge pattern). */
  async sendAssistantReply(chatId: string, contextToken: string, text: string): Promise<void> {
    if (!contextToken.trim()) {
      this.lastError = 'Missing context_token for WeChat reply'
      return
    }
    const formatted = formatAssistantTextForWeChat(text)
    const segments = splitWeChatTextSegments(formatted, ASSISTANT_TEXT_CHUNK)
    if (segments.length > 1) {
      const summary = buildWeChatSummaryFromFormatted(formatted)
      if (summary) {
        try {
          await this.client.sendText(chatId, contextToken, `结果摘要：${summary}`)
        } catch (error) {
          this.lastError = error instanceof Error ? error.message : 'Failed to send WeChat message'
          return
        }
      }
    }
    for (const segment of segments) {
      const prefix = segments.length > 1 && segment === segments[0] ? '详细内容：\n' : ''
      const chunk = `${prefix}${segment}`.trim()
      if (!chunk) continue
      try {
        await this.client.sendText(chatId, contextToken, chunk)
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : 'Failed to send WeChat message'
        return
      }
    }
  }

  async sendProgress(chatId: string, contextToken: string, text: string): Promise<void> {
    if (!contextToken.trim()) return
    try {
      await this.client.sendText(chatId, contextToken, text.trim())
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Failed to send WeChat progress'
    }
  }

  async sendImage(chatId: string, contextToken: string, imageBuffer: Buffer): Promise<void> {
    if (!contextToken.trim()) throw new Error('Missing context_token for WeChat image send')
    const aesKey = randomBytes(16)
    const aesKeyBase64 = aesKey.toString('base64')
    const filekey = randomBytes(16).toString('hex')
    const md5 = createHash('md5').update(imageBuffer).digest('hex')
    const uploadResp = await this.client.getUploadUrl({
      filekey,
      media_type: 1,
      to_user_id: chatId,
      rawsize: imageBuffer.length,
      rawfilemd5: md5,
      filesize: imageBuffer.length,
      aeskey: aesKeyBase64,
      no_need_thumb: true,
    })
    const uploadParam = uploadResp.upload_param
    if (!uploadParam) throw new Error('getUploadUrl: missing upload_param in response')
    const encryptQueryParam = await uploadWeChatCdnEncrypted(
      imageBuffer, uploadParam, aesKey, filekey, this.cdnBaseUrl,
    )
    const media: ILinkCdnMedia = { encrypt_query_param: encryptQueryParam, aes_key: aesKeyBase64 }
    await this.client.sendImage(chatId, contextToken, media)
  }

  async notifyTypingStart(chatId: string, contextToken: string): Promise<void> {
    try {
      const ticket = await this.resolveTypingTicket(chatId, contextToken)
      if (!ticket) return
      await this.client.sendTyping(chatId, ticket, 1)
    } catch {
      // best-effort
    }
  }

  beginTypingRefresh(chatId: string, contextToken: string): void {
    this.clearTypingTimer(chatId)
    const pump = (): void => {
      void (async () => {
        const ticket = await this.resolveTypingTicket(chatId, contextToken)
        if (!ticket) return
        void this.client.sendTyping(chatId, ticket, 1).catch(() => {})
      })()
    }
    const timer = setInterval(pump, 4000)
    this.typingTimers.set(chatId, timer)
  }

  endTypingIndicator(chatId: string, contextToken: string): void {
    this.clearTypingTimer(chatId)
    void (async () => {
      const ticket = await this.resolveTypingTicket(chatId, contextToken)
      if (!ticket) return
      void this.client.sendTyping(chatId, ticket, 2).catch(() => {})
    })()
  }

  clearAllTypingTimers(): void {
    for (const timer of this.typingTimers.values()) clearInterval(timer)
    this.typingTimers.clear()
  }

  private clearTypingTimer(chatId: string): void {
    const timer = this.typingTimers.get(chatId)
    if (!timer) return
    clearInterval(timer)
    this.typingTimers.delete(chatId)
  }

  private async resolveTypingTicket(chatId: string, contextToken: string): Promise<string | null> {
    const now = Date.now()
    const hit = this.typingTickets.get(chatId)
    if (hit && now - hit.at < TYPING_TICKET_TTL_MS) return hit.ticket
    try {
      const ticket = await this.client.getTypingTicket(chatId, contextToken || undefined)
      if (!ticket) return null
      this.typingTickets.set(chatId, { ticket, at: now })
      return ticket
    } catch {
      return null
    }
  }
}
