import { randomBytes, randomUUID } from 'node:crypto'

export type ILinkQrCodeResponse = {
  qrcode: string
  qrcode_url: string
}

export type ILinkQrCodeStatus = {
  status: 'pending' | 'scanned' | 'confirmed' | 'expired'
  bot_token?: string
  baseurl?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function pickTypingTicketFromGetConfig(rec: Record<string, unknown>): string {
  const direct = typeof rec.typing_ticket === 'string' ? rec.typing_ticket.trim() : ''
  if (direct) return direct
  const data = asRecord(rec.data)
  const nested = data && typeof data.typing_ticket === 'string' ? data.typing_ticket.trim() : ''
  return nested
}

function pickQrImageUrl(record: Record<string, unknown>): string {
  const direct =
    (typeof record.qrcode_url === 'string' && record.qrcode_url.trim()) ||
    (typeof record.qrcode_img_content === 'string' && record.qrcode_img_content.trim()) ||
    (typeof record.qrcodeImgContent === 'string' && record.qrcodeImgContent.trim()) ||
    ''
  const data = asRecord(record.data)
  if (direct || !data) return direct
  return (
    (typeof data.qrcode_url === 'string' && data.qrcode_url.trim()) ||
    (typeof data.qrcode_img_content === 'string' && data.qrcode_img_content.trim()) ||
    ''
  )
}

function normalizeQrLoginStatus(raw: string): ILinkQrCodeStatus['status'] {
  const s = raw.trim().toLowerCase()
  if (s === 'scaned' || s === 'scanned') return 'scanned'
  if (s === 'wait' || s === 'pending') return 'pending'
  if (s === 'confirmed') return 'confirmed'
  if (s === 'expired') return 'expired'
  return 'pending'
}

export type ILinkCdnMedia = {
  encrypt_query_param?: string
  aes_key?: string
  full_url?: string
  encrypt_type?: number
}

export type ILinkGetUploadUrlRequest = {
  filekey: string
  media_type: number
  to_user_id: string
  rawsize: number
  rawfilemd5: string
  filesize: number
  aeskey: string
  no_need_thumb?: boolean
}

export type ILinkGetUploadUrlResponse = {
  ret?: number
  errcode?: number
  errmsg?: string
  upload_param?: string
  thumb_upload_param?: string
}

export type ILinkMessageItem = {
  type: number
  text_item?: { text?: string }
  voice_item?: {
    text?: string
    media?: { encrypt_query_param?: string; aes_key?: string }
  }
  image_item?: {
    media?: ILinkCdnMedia
    aeskey?: string
  }
  file_item?: {
    file_name?: string
    media?: ILinkCdnMedia
  }
  video_item?: {
    media?: ILinkCdnMedia
  }
  ref_msg?: {
    title?: string
    message_item?: ILinkMessageItem
  }
}

export type ILinkIncomingMessage = {
  from_user_id?: string
  to_user_id?: string
  client_id?: string
  seq?: number
  message_id?: number
  create_time_ms?: number
  message_type?: number
  context_token?: string
  item_list?: ILinkMessageItem[]
  group_id?: string
}

export type ILinkUpdateResponse = {
  ret?: number
  errcode?: number
  errmsg?: string
  msgs?: ILinkIncomingMessage[]
  msg_list?: ILinkIncomingMessage[]
  get_updates_buf?: string
  longpolling_timeout_ms?: number
}

const ILINK_CHANNEL_BODY = { base_info: { channel_version: '2.0.0' } }

export class ILinkClient {
  private botToken = ''
  private baseUrl = 'https://ilinkai.weixin.qq.com'

  configure(botToken: string, baseUrl?: string): void {
    this.botToken = botToken
    if (baseUrl) this.baseUrl = baseUrl
  }

  get isConfigured(): boolean {
    return this.botToken.length > 0
  }

  get token(): string {
    return this.botToken
  }

  private generateUin(): string {
    const uint32 = randomBytes(4).readUInt32BE(0)
    return Buffer.from(String(uint32)).toString('base64')
  }

  private authHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      AuthorizationType: 'ilink_bot_token',
      'X-WECHAT-UIN': this.generateUin(),
      Authorization: `Bearer ${this.botToken}`,
    }
  }

  async getQrCode(): Promise<ILinkQrCodeResponse> {
    const res = await fetch(`${this.baseUrl}/ilink/bot/get_bot_qrcode?bot_type=3`, {
      signal: AbortSignal.timeout(25_000),
    })
    if (!res.ok) throw new Error(`getQrCode failed: ${res.status}`)
    const record = asRecord(await res.json())
    if (!record) throw new Error('getQrCode: invalid response body')
    const ret = record.ret
    if (typeof ret === 'number' && ret !== 0) throw new Error(`getQrCode ret: ${ret}`)
    const qrcode = typeof record.qrcode === 'string' ? record.qrcode.trim() : ''
    const qrcode_url = pickQrImageUrl(record)
    if (!qrcode || !qrcode_url) throw new Error('getQrCode: missing qrcode or qrcode_url in response')
    return { qrcode, qrcode_url }
  }

  async getQrCodeStatus(qrcode: string): Promise<ILinkQrCodeStatus> {
    const res = await fetch(
      `${this.baseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      { signal: AbortSignal.timeout(45_000) },
    )
    if (!res.ok) throw new Error(`getQrCodeStatus failed: ${res.status}`)
    const record = asRecord(await res.json())
    if (!record) throw new Error('getQrCodeStatus: invalid response body')
    const statusRaw = typeof record.status === 'string' ? record.status : ''
    const status = normalizeQrLoginStatus(statusRaw)
    const bot_token =
      typeof record.bot_token === 'string' ? record.bot_token
      : typeof record.botToken === 'string' ? record.botToken
      : undefined
    const baseurl =
      typeof record.baseurl === 'string' ? record.baseurl
      : typeof record.base_url === 'string' ? record.base_url
      : undefined
    return { status, bot_token, baseurl }
  }

  async getUpdates(cursor: string, timeoutMs = 38_000): Promise<ILinkUpdateResponse> {
    let res: Response
    try {
      res = await fetch(`${this.baseUrl}/ilink/bot/getupdates`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ ...ILINK_CHANNEL_BODY, get_updates_buf: cursor }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { ret: 0, msgs: [], get_updates_buf: cursor }
      }
      throw error
    }
    if (!res.ok) throw new Error(`getUpdates failed: ${res.status}`)
    const raw = asRecord(await res.json())
    if (!raw) throw new Error('getUpdates: invalid JSON body')
    return raw as ILinkUpdateResponse
  }

  async sendMessage(toUserId: string, contextToken: string, items: ILinkMessageItem[]): Promise<void> {
    const payload = {
      ...ILINK_CHANNEL_BODY,
      msg: {
        from_user_id: '',
        to_user_id: toUserId,
        client_id: `codex-app-${randomUUID()}`,
        message_type: 2,
        message_state: 2,
        context_token: contextToken,
        item_list: items,
      },
    }
    const res = await fetch(`${this.baseUrl}/ilink/bot/sendmessage`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`sendMessage failed: ${res.status}`)
    const rawText = await res.text()
    const trimmed = rawText.trim()
    if (!trimmed) return
    let body: Record<string, unknown> | null = null
    try {
      body = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      return
    }
    const rec = asRecord(body)
    if (!rec) return
    const ret = typeof rec.ret === 'number' ? rec.ret : 0
    const errcode = typeof rec.errcode === 'number' ? rec.errcode : undefined
    if (ret !== 0 || (errcode !== undefined && errcode !== 0)) {
      const err = typeof rec.errmsg === 'string' ? rec.errmsg : `ret=${ret} errcode=${errcode ?? 'n/a'}`
      throw new Error(`sendMessage: ${err}`)
    }
  }

  async getTypingTicket(ilinkUserId: string, contextToken?: string): Promise<string> {
    const body: Record<string, unknown> = { ...ILINK_CHANNEL_BODY, ilink_user_id: ilinkUserId }
    if (contextToken?.trim()) body.context_token = contextToken.trim()
    const res = await fetch(`${this.baseUrl}/ilink/bot/getconfig`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) throw new Error(`getTypingTicket failed: ${res.status}`)
    const rawText = await res.text()
    const trimmed = rawText.trim()
    if (!trimmed) return ''
    let rec: Record<string, unknown>
    try {
      rec = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      return ''
    }
    const ret = typeof rec.ret === 'number' ? rec.ret : 0
    const errcode = typeof rec.errcode === 'number' ? rec.errcode : undefined
    if (ret !== 0 || (errcode !== undefined && errcode !== 0)) {
      const err = typeof rec.errmsg === 'string' ? rec.errmsg : `ret=${ret} errcode=${errcode ?? 'n/a'}`
      throw new Error(`getTypingTicket: ${err}`)
    }
    return pickTypingTicketFromGetConfig(rec)
  }

  async sendTyping(ilinkUserId: string, typingTicket: string, status: 1 | 2): Promise<void> {
    const res = await fetch(`${this.baseUrl}/ilink/bot/sendtyping`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ ...ILINK_CHANNEL_BODY, ilink_user_id: ilinkUserId, typing_ticket: typingTicket, status }),
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) throw new Error(`sendTyping failed: ${res.status}`)
    const rawText = await res.text()
    const trimmed = rawText.trim()
    if (!trimmed) return
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      return
    }
    const ret = typeof parsed.ret === 'number' ? parsed.ret : 0
    const errcode = typeof parsed.errcode === 'number' ? parsed.errcode : undefined
    if (ret !== 0 || (errcode !== undefined && errcode !== 0)) {
      const err = typeof parsed.errmsg === 'string' ? parsed.errmsg : `ret=${ret} errcode=${errcode ?? 'n/a'}`
      throw new Error(`sendTyping: ${err}`)
    }
  }

  async sendText(toUserId: string, contextToken: string, text: string): Promise<void> {
    await this.sendMessage(toUserId, contextToken, [{ type: 1, text_item: { text } }])
  }

  async sendImage(toUserId: string, contextToken: string, media: ILinkCdnMedia): Promise<void> {
    await this.sendMessage(toUserId, contextToken, [{ type: 2, image_item: { media } }])
  }

  async getUploadUrl(request: ILinkGetUploadUrlRequest): Promise<ILinkGetUploadUrlResponse> {
    const res = await fetch(`${this.baseUrl}/ilink/bot/getuploadurl`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ base_info: { channel_version: '2.0.0' }, ...request }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`getUploadUrl failed: HTTP ${res.status}`)
    const rawText = await res.text()
    const trimmed = rawText.trim()
    if (!trimmed) throw new Error('getUploadUrl: empty response')
    const body = JSON.parse(trimmed) as ILinkGetUploadUrlResponse
    const ret = typeof body.ret === 'number' ? body.ret : 0
    const errcode = typeof body.errcode === 'number' ? body.errcode : undefined
    if (ret !== 0 || (errcode !== undefined && errcode !== 0)) {
      const err = typeof body.errmsg === 'string' ? body.errmsg : `ret=${ret} errcode=${errcode ?? 'n/a'}`
      throw new Error(`getUploadUrl: ${err}`)
    }
    return body
  }
}
