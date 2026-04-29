import { renderTelegramHtmlSegments, renderTelegramMarkdownSegments } from '@/format'
import type { TelegramSender } from '@/sender'

export type StreamRenderMode = 'classic' | 'hermes'

export type StreamEditorConfig = {
  readonly editIntervalMs: number
  readonly maxEditLength: number
  readonly maxEditFailures: number
  readonly maxEditIntervalMs: number
  readonly renderMode: StreamRenderMode
}

const DEFAULTS: StreamEditorConfig = {
  editIntervalMs: 2000,
  maxEditLength: 3800,
  maxEditFailures: 3,
  maxEditIntervalMs: 8000,
  renderMode: 'classic',
}

export class EditStreamEditor {
  private readonly cfg: StreamEditorConfig
  private activeMessageId: number | null = null
  private lastEditTime = 0
  private lastPreviewText = ''
  private editTimer: ReturnType<typeof setTimeout> | null = null
  private failures = 0
  private fallen = false
  private fullRawText = ''
  private currentEditInterval: number

  constructor(
    private readonly sender: TelegramSender,
    private readonly chatId: number,
    config?: Partial<StreamEditorConfig>,
  ) {
    this.cfg = { ...DEFAULTS, ...config }
    this.currentEditInterval = this.cfg.editIntervalMs
  }

  reuseMessage(messageId: number): void {
    this.activeMessageId = messageId
  }

  async appendText(text: string): Promise<void> {
    if (!text) return
    this.fullRawText += text
    // If we fell back due to edit failures (usually flood control), do not
    // spam Telegram with per-token messages. Keep buffering and rely on
    // finalize() to deliver the final answer segments.
    if (this.fallen) return
    this.scheduleEdit()
  }

  seedFinalText(text: string): void {
    if (!this.fullRawText && text.trim()) {
      this.fullRawText = text
    }
  }

  async finalize(): Promise<void> {
    this.clearTimer()
    const segments = this.renderFinalSegments()
    if (!segments.length) return
    await this.publishFinalSegments(segments)
  }

  get hasContent(): boolean {
    return this.fullRawText.trim().length > 0
  }

  get fullText(): string {
    return this.fullRawText
  }

  private renderFinalSegments(): readonly string[] {
    if (!this.fullRawText.trim()) return []
    return this.cfg.renderMode === 'hermes'
      ? renderTelegramHtmlSegments(this.fullRawText)
      : renderTelegramMarkdownSegments(this.fullRawText)
  }

  private async publishFinalSegments(segments: readonly string[]): Promise<void> {
    const [first, ...rest] = segments
    const reused = await this.tryReuseFirstSegment(first)
    if (!reused) {
      await this.sendFinalSegment(first)
    }
    for (const seg of rest) {
      await this.sendFinalSegment(seg)
    }
  }

  private async tryReuseFirstSegment(segment: string): Promise<boolean> {
    if (this.activeMessageId === null || this.fallen) return false
    try {
      if (this.cfg.renderMode === 'hermes') {
        await this.sender.editHtmlMessage(this.chatId, this.activeMessageId, segment)
      } else {
        await this.sender.editRichMessage(this.chatId, this.activeMessageId, segment)
      }
      return true
    } catch {
      this.activeMessageId = null
      return false
    }
  }

  private async sendFinalSegment(segment: string): Promise<void> {
    if (this.cfg.renderMode === 'hermes') {
      await this.sender.sendHtmlMessage(this.chatId, segment)
      return
    }
    await this.sender.sendRichMessage(this.chatId, segment)
  }

  private scheduleEdit(): void {
    const elapsed = Date.now() - this.lastEditTime
    if (elapsed >= this.currentEditInterval) {
      void this.doEdit()
      return
    }
    if (this.editTimer !== null) return
    this.editTimer = setTimeout(() => {
      this.editTimer = null
      void this.doEdit()
    }, this.currentEditInterval - elapsed)
  }

  private async doEdit(): Promise<void> {
    const preview = this.renderPreview()
    if (!preview.trim() || preview === this.lastPreviewText) return

    if (this.activeMessageId === null) {
      this.activeMessageId = await this.sender.sendMessage(this.chatId, preview)
      this.lastPreviewText = preview
      this.lastEditTime = Date.now()
      return
    }

    try {
      await this.sender.editMessageText(this.chatId, this.activeMessageId, preview)
      this.failures = 0
      this.currentEditInterval = this.cfg.editIntervalMs
      this.lastPreviewText = preview
    } catch (err: unknown) {
      if (this.isNoopEdit(err)) return
      this.onEditFailure(err)
    }
    this.lastEditTime = Date.now()
  }

  private renderPreview(): string {
    const text = this.fullRawText.slice(-this.cfg.maxEditLength)
    return text.length > this.cfg.maxEditLength
      ? '...' + text.slice(-(this.cfg.maxEditLength - 3))
      : text
  }

  private onEditFailure(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err)
    if (this.isFloodControl(message)) {
      this.currentEditInterval = Math.min(this.currentEditInterval * 2, this.cfg.maxEditIntervalMs)
      // Flood control is temporary; do not treat it as a hard failure.
      return
    }
    this.failures += 1
    if (this.failures >= this.cfg.maxEditFailures) {
      this.fallen = true
    }
  }

  private isNoopEdit(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err)
    return message.includes('message is not modified')
  }

  private isFloodControl(message: string): boolean {
    return message.includes('Too Many Requests') || message.includes('retry after')
  }

  private clearTimer(): void {
    if (this.editTimer !== null) {
      clearTimeout(this.editTimer)
      this.editTimer = null
    }
  }
}
