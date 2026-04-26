import { StreamCoalescer } from '@codex-app/core'
import type { TelegramSender } from '@/sender'
import { EditStreamEditor, type StreamRenderMode } from '@/streamEditor'

export type TelegramStreamingConfig = {
  readonly editIntervalMs?: number
  readonly minChars?: number
  readonly maxChars?: number
  readonly idleMs?: number
  readonly maxEditFailures?: number
}

type StreamSegment = {
  readonly editor: EditStreamEditor
  readonly coalescer: StreamCoalescer
}

const DEFAULTS = {
  editIntervalMs: 2000,
  minChars: 20,
  maxChars: 2000,
  idleMs: 300,
  maxEditFailures: 3,
} as const

export class TelegramStreamConsumer {
  private segment: StreamSegment | null = null
  private readonly pendingMessageIds: number[]
  private deliveredText = false

  constructor(
    private readonly sender: TelegramSender,
    private readonly chatId: number,
    private readonly renderMode: StreamRenderMode,
    private readonly config?: TelegramStreamingConfig,
    reuseMessageId?: number,
  ) {
    this.pendingMessageIds = reuseMessageId ? [reuseMessageId] : []
  }

  async onDelta(text: string): Promise<void> {
    if (!text) return
    const segment = this.ensureSegment()
    await segment.coalescer.feed(text)
  }

  async onCommentary(text: string): Promise<void> {
    if (!text.trim()) return
    await this.onSegmentBreak()
    if (this.renderMode === 'hermes') {
      await this.sender.sendHtmlMessage(this.chatId, text)
      return
    }
    await this.sender.sendRichMessage(this.chatId, text)
  }

  async onSegmentBreak(): Promise<void> {
    await this.closeSegment()
  }

  async finalize(finalText?: string): Promise<boolean> {
    if (this.segment) {
      this.segment.editor.seedFinalText(finalText ?? '')
      await this.closeSegment()
      return this.deliveredText
    }
    return this.deliveredText
  }

  get hasDeliveredText(): boolean {
    return this.deliveredText
  }

  private ensureSegment(): StreamSegment {
    if (this.segment) return this.segment
    const editor = new EditStreamEditor(this.sender, this.chatId, {
      editIntervalMs: this.config?.editIntervalMs ?? DEFAULTS.editIntervalMs,
      maxEditLength: 4000,
      maxEditFailures: this.config?.maxEditFailures ?? DEFAULTS.maxEditFailures,
      renderMode: this.renderMode,
    })
    const reuseMessageId = this.pendingMessageIds.shift()
    if (reuseMessageId) {
      editor.reuseMessage(reuseMessageId)
    }
    const coalescer = new StreamCoalescer(
      {
        minChars: this.config?.minChars ?? DEFAULTS.minChars,
        maxChars: this.config?.maxChars ?? DEFAULTS.maxChars,
        idleMs: this.config?.idleMs ?? DEFAULTS.idleMs,
      },
      text => editor.appendText(text),
    )
    this.segment = { editor, coalescer }
    return this.segment
  }

  private async closeSegment(): Promise<void> {
    const segment = this.segment
    if (!segment) return
    this.segment = null
    try {
      await segment.coalescer.flush()
      await segment.editor.finalize()
      if (segment.editor.hasContent) {
        this.deliveredText = true
      }
    } finally {
      segment.coalescer.destroy()
    }
  }
}
