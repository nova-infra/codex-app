/** Channel-agnostic 命令回复结构 */
export type CommandReply = {
  readonly text: string                        // 消息正文（纯文本，channel 负责格式化）
  readonly buttons?: readonly ReplyButton[][]  // 按钮行（Telegram InlineKeyboard / WeChat 数字列表）
  readonly pendingAction?: PendingAction       // 需要异步跟进的动作
}

export type ReplyButton = {
  readonly label: string   // 按钮显示文本
  readonly action: string  // callback_data (如 "cx:switch:acct_xxx")
  readonly url?: string    // URL 按钮 (Telegram native link button)
}

export type PendingAction = {
  readonly kind: 'oauth_login'
  readonly state: string  // OAuth state，用于 callback 匹配
}

/** Channel 上下文，用于 OAuth callback 反向通知 */
export type ChannelCallbackContext = {
  readonly channelType: 'telegram' | 'wechat'
  readonly chatId: string  // Telegram chatId 或 WeChat userId
  readonly state: string
  readonly createdAt: number
}
