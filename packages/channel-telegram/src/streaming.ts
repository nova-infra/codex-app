import { StreamCoalescer } from '@codex-app/core'
import type { TelegramSender } from '@/sender'
import { EditStreamEditor } from '@/streamEditor'

export type TelegramStreamingConfig = {
  readonly editIntervalMs?: number
  readonly minChars?: number
  readonly maxChars?: number
  readonly idleMs?: number
  readonly maxEditFailures?: number
}

export type StreamingState = {
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

export function createStreamingState(
  sender: TelegramSender,
  chatId: number,
  config?: TelegramStreamingConfig,
  reuseMessageId?: number,
): StreamingState {
  const editor = new EditStreamEditor(sender, chatId, {
    editIntervalMs: config?.editIntervalMs ?? DEFAULTS.editIntervalMs,
    maxEditLength: 4000,
    maxEditFailures: config?.maxEditFailures ?? DEFAULTS.maxEditFailures,
  })

  if (reuseMessageId) {
    editor.reuseMessage(reuseMessageId)
  }

  const coalescer = new StreamCoalescer(
    {
      minChars: config?.minChars ?? DEFAULTS.minChars,
      maxChars: config?.maxChars ?? DEFAULTS.maxChars,
      idleMs: config?.idleMs ?? DEFAULTS.idleMs,
    },
    (text) => editor.appendText(text),
  )

  return { editor, coalescer }
}

export async function finalizeStreamingState(state: StreamingState): Promise<void> {
  try {
    await state.coalescer.flush()
    await state.editor.finalize()
  } finally {
    state.coalescer.destroy()
  }
}
