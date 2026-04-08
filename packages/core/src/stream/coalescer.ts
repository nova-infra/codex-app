export type CoalescerConfig = {
  readonly minChars: number
  readonly maxChars: number
  readonly idleMs: number
}

export type OnFlush = (text: string) => void | Promise<void>

const DEFAULTS: CoalescerConfig = {
  minChars: 80,
  maxChars: 2000,
  idleMs: 600,
}

const SENTENCE_END = /[.!?][\s\n]/g

export class StreamCoalescer {
  private readonly cfg: CoalescerConfig
  private readonly onFlush: OnFlush
  private buffer = ''
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private _flushing = false

  constructor(config: Partial<CoalescerConfig>, onFlush: OnFlush) {
    this.cfg = { ...DEFAULTS, ...config }
    this.onFlush = onFlush
  }

  async feed(delta: string): Promise<void> {
    this.buffer += delta
    this._clearIdleTimer()

    if (this._flushing) return

    const { minChars, maxChars, idleMs } = this.cfg
    const buf = this.buffer

    // Priority 1: exceeded maxChars → flush all
    if (buf.length >= maxChars) {
      await this._emit(this.buffer)
      return
    }

    if (buf.length >= minChars) {
      // Priority 2: double newline found → cut at last \n\n
      const nnIdx = buf.lastIndexOf('\n\n')
      if (nnIdx !== -1) {
        const head = buf.slice(0, nnIdx + 2)
        this.buffer = buf.slice(nnIdx + 2)
        await this._emit(head)
        return
      }

      // Priority 3: sentence end found → cut at last sentence end
      const sentIdx = this._lastSentenceEnd(buf)
      if (sentIdx !== -1) {
        const head = buf.slice(0, sentIdx + 2)
        this.buffer = buf.slice(sentIdx + 2)
        await this._emit(head)
        return
      }

      // Priority 4: minChars met but no breakpoint → idle timer
      this.idleTimer = setTimeout(async () => {
        this.idleTimer = null
        await this._emit(this.buffer)
      }, idleMs)
    }

    // Priority 5: buffer < minChars → keep buffering
  }

  async flush(): Promise<void> {
    this._clearIdleTimer()
    if (this.buffer.length > 0) {
      await this._emit(this.buffer)
    }
  }

  destroy(): void {
    this._clearIdleTimer()
  }

  private async _emit(text: string): Promise<void> {
    if (!text || this._flushing) return
    this._flushing = true
    this.buffer = ''
    try {
      await this.onFlush(text)
    } finally {
      this._flushing = false
    }
  }

  private _clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private _lastSentenceEnd(text: string): number {
    let last = -1
    let match: RegExpExecArray | null
    SENTENCE_END.lastIndex = 0
    while ((match = SENTENCE_END.exec(text)) !== null) {
      last = match.index
    }
    return last
  }
}
