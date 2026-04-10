import { telegramHtmlToPlainText } from '@/format'
import type { InlineKeyboard } from '@/types'

export const EDIT_INTERVAL_MS = 800

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

export class TelegramSender {
  constructor(private readonly token: string) {}

  async sendMessage(
    chatId: number,
    text: string,
    opts?: InlineKeyboard | { parse_mode?: string; reply_markup?: InlineKeyboard },
  ): Promise<number> {
    const trimmed = text.trim()
    if (!trimmed) return 0
    const body: Record<string, unknown> = { chat_id: chatId, text: trimmed }
    if (opts && 'inline_keyboard' in opts) {
      body.reply_markup = opts
    } else if (opts) {
      if (opts.parse_mode) body.parse_mode = opts.parse_mode
      if (opts.reply_markup) body.reply_markup = opts.reply_markup
    }
    const data = asRecord(await this.post('sendMessage', body))
    const result = asRecord(data?.result)
    return typeof result?.message_id === 'number' ? result.message_id : 0
  }

  async editMessageText(chatId: number, messageId: number, text: string, parseMode?: string): Promise<void> {
    if (!text.trim() || !messageId) return
    const body: Record<string, unknown> = {
      chat_id: chatId,
      message_id: messageId,
      text: text.trim(),
    }
    if (parseMode) body.parse_mode = parseMode
    try {
      await this.post('editMessageText', body)
    } catch (err) {
      if (this.isNoopEditError(err)) return
      throw err
    }
  }

  async sendHtmlMessage(chatId: number, html: string): Promise<number> {
    try {
      return await this.sendMessage(chatId, html, { parse_mode: 'HTML' })
    } catch (err) {
      if (!this.isFormattingError(err)) throw err
      return await this.sendMessage(chatId, telegramHtmlToPlainText(html))
    }
  }

  async editHtmlMessage(chatId: number, messageId: number, html: string): Promise<void> {
    try {
      await this.editMessageText(chatId, messageId, html, 'HTML')
    } catch (err) {
      if (!this.isFormattingError(err)) throw err
      await this.editMessageText(chatId, messageId, telegramHtmlToPlainText(html))
    }
  }

  async deleteMessage(chatId: number, messageId: number): Promise<void> {
    if (!messageId) return
    await this.post('deleteMessage', { chat_id: chatId, message_id: messageId })
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    const body: Record<string, unknown> = { callback_query_id: callbackQueryId }
    if (text) body.text = text
    await this.post('answerCallbackQuery', body)
  }

  async sendChatAction(chatId: number): Promise<void> {
    await this.post('sendChatAction', { chat_id: chatId, action: 'typing' })
  }

  async setMyCommands(commands: Array<{ command: string; description: string }>): Promise<void> {
    await this.post('setMyCommands', { commands })
  }

  async downloadPhoto(fileId: string): Promise<string> {
    const getFileRes = await fetch(
      `https://api.telegram.org/bot${this.token}/getFile?file_id=${encodeURIComponent(fileId)}`,
    )
    if (!getFileRes.ok) throw new Error(`getFile failed: ${getFileRes.status}`)
    const fileData = await getFileRes.json() as { result?: { file_path?: string } }
    const filePath = fileData.result?.file_path
    if (!filePath) throw new Error('getFile: missing file_path')
    const dlRes = await fetch(
      `https://api.telegram.org/file/bot${this.token}/${filePath}`,
    )
    if (!dlRes.ok) throw new Error(`download failed: ${dlRes.status}`)
    const buf = Buffer.from(await dlRes.arrayBuffer())
    return `data:image/jpeg;base64,${buf.toString('base64')}`
  }

  private url(method: string): string {
    return `https://api.telegram.org/bot${this.token}/${method}`
  }

  private isFormattingError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err)
    return [
      "can't parse entities",
      'unsupported start tag',
      "can't find end tag",
      'message is too long',
      'entity end',
    ].some(fragment => message.includes(fragment))
  }

  private isNoopEditError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err)
    return message.includes('message is not modified')
  }

  private async post(method: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(this.url(method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    const result = asRecord(json)
    if (result && result.ok === false) {
      const description = typeof result.description === 'string'
        ? result.description
        : JSON.stringify(json)
      console.error(`[telegram] API ${method} failed:`, description)
      throw new Error(`Telegram API ${method} failed: ${description}`)
    }
    return json
  }
}
