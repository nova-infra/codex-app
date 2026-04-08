import { markdownToTelegramHtml, splitTelegramMessage } from './format'
import type { TelegramSender } from './sender'

export type StreamEditorConfig = {
  readonly editIntervalMs: number
  readonly maxEditLength: number
  readonly maxEditFailures: number
}

type EditorState = 'idle' | 'editing' | 'sealed' | 'appending'

type ToolEntry = { readonly name: string; readonly count: number }

const DEFAULTS: StreamEditorConfig = {
  editIntervalMs: 2000,
  maxEditLength: 4000,
  maxEditFailures: 3,
}

function renderToolIndicators(entries: readonly ToolEntry[]): string {
  if (entries.length === 0) return ''
  const line = entries
    .map(e => (e.count > 1 ? `[${e.name}] x${e.count}` : `[${e.name}]`))
    .join(' ')
  return `\n\n<i>${line}</i>`
}

export class EditStreamEditor {
  private readonly cfg: StreamEditorConfig
  private rawParts: readonly string[] = []
  private toolEntries: readonly ToolEntry[] = []
  private activeMessageId: number | null = null
  private lastEditTime = 0
  private editTimer: ReturnType<typeof setTimeout> | null = null
  private failures = 0
  private state: EditorState = 'idle'
  private fullRawText = ''

  constructor(
    private readonly sender: TelegramSender,
    private readonly chatId: number,
    config?: Partial<StreamEditorConfig>,
  ) {
    this.cfg = { ...DEFAULTS, ...config }
  }

  async appendText(text: string): Promise<void> {
    this.fullRawText += text

    if (this.state === 'appending') {
      const html = markdownToTelegramHtml(text)
      await this.sender.sendMessage(this.chatId, html, { parse_mode: 'HTML' })
      return
    }

    this.rawParts = [...this.rawParts, text]
    this.scheduleEdit()
  }

  async appendTool(toolName: string): Promise<void> {
    if (this.state === 'appending') {
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

  async finalize(): Promise<void> {
    if (this.editTimer !== null) {
      clearTimeout(this.editTimer)
      this.editTimer = null
    }
    this.toolEntries = []
    await this.doEdit()
  }

  get hasContent(): boolean {
    return this.activeMessageId !== null
  }

  get fullText(): string {
    return this.fullRawText
  }

  private renderActiveHtml(): string {
    const raw = this.rawParts.join('')
    const html = markdownToTelegramHtml(raw)
    return html + renderToolIndicators(this.toolEntries)
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
    const html = this.renderActiveHtml()
    if (!html.trim()) return

    if (html.length > this.cfg.maxEditLength) {
      await this.handleOverflow(html)
      return
    }

    if (this.activeMessageId === null) {
      this.activeMessageId = await this.sender.sendMessage(
        this.chatId,
        html,
        { parse_mode: 'HTML' },
      )
    } else {
      try {
        await this.sender.editMessageText(
          this.chatId,
          this.activeMessageId,
          html,
          'HTML',
        )
        this.failures = 0
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!msg.includes('message is not modified')) {
          this.failures++
          if (this.failures >= this.cfg.maxEditFailures) {
            this.state = 'appending'
          }
        }
      }
    }

    this.lastEditTime = Date.now()
  }

  private async handleOverflow(html: string): Promise<void> {
    const chunks = splitTelegramMessage(html, this.cfg.maxEditLength)

    // Edit current message with first chunk (sealing it)
    if (this.activeMessageId !== null) {
      try {
        await this.sender.editMessageText(
          this.chatId,
          this.activeMessageId,
          chunks[0],
          'HTML',
        )
      } catch {
        // sealed regardless — ignore errors
      }
    } else {
      this.activeMessageId = await this.sender.sendMessage(
        this.chatId,
        chunks[0],
        { parse_mode: 'HTML' },
      )
    }

    // Send remaining chunks; last one becomes the new active message
    for (let i = 1; i < chunks.length; i++) {
      this.activeMessageId = await this.sender.sendMessage(
        this.chatId,
        chunks[i],
        { parse_mode: 'HTML' },
      )
    }

    // All accumulated raw content has been committed — reset for fresh accumulation
    this.rawParts = []
    this.lastEditTime = Date.now()
  }
}
