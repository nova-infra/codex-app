export type ChannelKey = 'telegram' | 'wechat'

export type ChannelMeta = {
  readonly key: ChannelKey
  readonly label: string
  readonly description: string
  readonly defaultEnabled: boolean
  readonly requiredCapabilities: readonly string[]
}

const CHANNELS: readonly ChannelMeta[] = [
  {
    key: 'telegram',
    label: 'Telegram',
    description: 'Telegram long-polling channel with rich rendering and approval callbacks.',
    defaultEnabled: true,
    requiredCapabilities: ['storage-adapter', 'notification-adapter'],
  },
  {
    key: 'wechat',
    label: 'WeChat',
    description: 'WeChat iLink channel with text fallback, approval replies, and image relay.',
    defaultEnabled: true,
    requiredCapabilities: ['storage-adapter', 'notification-adapter', 'image-relay'],
  },
] as const

export function listChannels(): readonly ChannelMeta[] {
  return CHANNELS
}

export function getChannel(key: string): ChannelMeta | null {
  return CHANNELS.find(channel => channel.key === key) ?? null
}
