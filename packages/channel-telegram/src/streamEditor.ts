import { renderTelegramHtmlSegments } from '@/format'
import type { TelegramSender } from '@/sender'

export type StreamEditorConfig = {
  readonly editIntervalMs: number
  readonly maxEditLength: number
  readonly maxEditFailures: number
}

type ToolEntry = { readonly name: string; readonly count: number }

const DEFAULTS: StreamEditorConfig = {
  editIntervalMs: 2000,
  maxEditLength: 3800,
  maxEditFailures: 3,
}

function renderToolLine(entries: readonly ToolEntry[]): string {
  if (entries.length === 0) return ''
  return '\n\n' + entries
    .map(e => (e.count > 1 ? `[${e.name}] x${e.count}` : `[${e.name}]`))
    .join(' ')
}

export class EditStreamEditor {
  private readonly cfg: StreamEditorConfig
  private toolEntries: readonly ToolEntry[] = []
  private activeMessageId: number | null = null
  private lastEditTime = 0
  private editTimer: ReturnType<typeof setTimeout> | null = null
  private failures = 0
  private fallen = false
  private fullRawText = ''

  constructor(
    private readonly sender: TelegramSender,
    private readonly chatId: number,
    config?: Partial<StreamEditorConfig>,
  ) {
    this.cfg = { ...DEFAULTS, ...config }
  }

  /** Reuse an existing message (e.g. the progress indicator). */
  reuseMessage(messageId: number): void {
    this.activeMessageId = messageId
  }

  // -- Public API --

  async appendText(text: string): Promise<void> {
    this.fullRawText += text

    if (this.fallen) {
      // Append mode: just send plain text chunks
      await this.sender.sendMessage(this.chatId, text)
      return
    }

    this.scheduleEdit()
  }

  async appendTool(toolName: string): Promise<void> {
    if (this.fallen) {
      await this.sender.sendMessage(this.chatId, `[${toolName}]`)
      return
    }

    const last = this.toolEntries[this.toolEntries.length - 1]
    if (last && last.name === toolName) {
      this.toolEntries = [
        ...this.toolEntries.slice(0, -1),
        { name: toolName, count: last.count + 1 },
      ]
    } else {
      this.toolEntries = [...this.toolEntries, { name: toolName, count: 1 }]
    }

    this.scheduleEdit()
  }

  seedFinalText(text: string): void {
    if (!this.fullRawText && text.trim()) {
      this.fullRawText = text
    }
  }

  /** Finalize by upgrading the preview message into the formatted response. */
  async finalize(): Promise<void> {
    if (this.editTimer !== null) {
      clearTimeout(this.editTimer)
      this.editTimer = null
    }

    const segments = this.renderFinalSegments()
    if (segments.length === 0) return

    const [firstSegment, ...restSegments] = segments

    if (this.activeMessageId !== null && !this.fallen) {
      try {
        await this.sender.editHtmlMessage(
          this.chatId,
          this.activeMessageId,
          firstSegment,
        )
        await this.sendHtmlSegments(restSegments)
        return
      } catch {
        this.activeMessageId = null
      }
    }

    await this.sendHtmlSegments(segments)
  }

  get hasContent(): boolean {
    return this.fullRawText.length > 0
  }

  get fullText(): string {
    return this.fullRawText
  }

  // -- Internal --

  /** Render preview: plain text with tool indicators (no HTML, no markdown parsing). */
  private renderPreview(): string {
    const preview = this.fullRawText.slice(-this.cfg.maxEditLength)
    return preview + renderToolLine(this.toolEntries)
  }

  private renderFinalSegments(): string[] {
    if (!this.fullRawText.trim()) return []
    return [...renderTelegramHtmlSegments(this.fullRawText)]
  }

  private async sendHtmlSegments(segments: readonly string[]): Promise<void> {
    for (const seg of segments) {
      await this.sender.sendHtmlMessage(this.chatId, seg)
    }
  }

  private scheduleEdit(): void {
    const elapsed = Date.now() - this.lastEditTime
    if (elapsed >= this.cfg.editIntervalMs) {
      void this.doEdit()
    } else if (!this.editTimer) {
      this.editTimer = setTimeout(() => {
        this.editTimer = null
        void this.doEdit()
      }, this.cfg.editIntervalMs - elapsed)
    }
  }

  private async doEdit(): Promise<void> {
    const text = this.renderPreview()
    if (!text.trim()) return

    // Truncate to fit TG limit (plain text, no HTML parsing issues)
    const display = text.length > this.cfg.maxEditLength
      ? '...' + text.slice(-(this.cfg.maxEditLength - 3))
      : text

    if (this.activeMessageId === null) {
      // First message: send as plain text (no parse_mode)
      this.activeMessageId = await this.sender.sendMessage(this.chatId, display)
    } else {
      try {
        await this.sender.editMessageText(
          this.chatId,
          this.activeMessageId,
          display,
        )
        this.failures = 0
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!msg.includes('message is not modified')) {
          this.failures++
          if (this.failures >= this.cfg.maxEditFailures) {
            this.fallen = true
          }
        }
      }
    }

    this.lastEditTime = Date.now()
  }
}
