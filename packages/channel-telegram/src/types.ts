export type TelegramPhoto = {
  readonly file_id?: string
  readonly file_size?: number
  readonly width?: number
  readonly height?: number
}

export type TelegramUpdate = {
  readonly update_id?: number
  readonly message?: {
    readonly message_id?: number
    readonly text?: string
    readonly caption?: string
    readonly photo?: readonly TelegramPhoto[]
    readonly chat?: { readonly id?: number }
  }
  readonly callback_query?: {
    readonly id?: string
    readonly data?: string
    readonly message?: {
      readonly message_id?: number
      readonly chat?: { readonly id?: number }
    }
  }
}

export type TelegramCommand = {
  readonly command: string
  readonly description: string
}

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export type InlineKeyboardButton =
  | { readonly text: string; readonly callback_data: string }
  | { readonly text: string; readonly url: string }

export type InlineKeyboard = {
  readonly inline_keyboard: readonly (readonly InlineKeyboardButton[])[]
}

export const REASONING_EFFORTS: readonly ReasoningEffort[] = [
  'none', 'minimal', 'low', 'medium', 'high', 'xhigh',
]

export const BOT_COMMANDS: readonly TelegramCommand[] = [
  { command: 'new', description: '新建会话' },
  { command: 'session', description: '选择会话' },
  { command: 'model', description: '选择模型' },
  { command: 'reasoning', description: '选择推理深度' },
  { command: 'status', description: '查看状态' },
  { command: 'help', description: '查看命令说明' },
]

export const MODEL_PICKER_LIMIT = 20
