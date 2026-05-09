import type { ChannelKey } from '@/registry/channelRegistry'
import type { CapabilityKey } from '@/registry/capabilityRegistry'

export type PresetKey = 'minimal' | 'telegram-only' | 'wechat-only' | 'social'

export type PresetDefinition = {
  readonly key: PresetKey
  readonly description: string
  readonly channels: Readonly<Record<ChannelKey, boolean>>
  readonly capabilities: Readonly<Record<CapabilityKey, boolean>>
}

const PRESETS: readonly PresetDefinition[] = [
  {
    key: 'minimal',
    description: 'Core runtime only for gateway and contract debugging.',
    channels: { telegram: false, wechat: false },
    capabilities: {
      skills: false,
      tools: false,
      mcp: false,
      'provider-profiles': false,
      'storage-adapter': true,
      'image-relay': false,
      'notification-adapter': true,
    },
  },
  {
    key: 'telegram-only',
    description: 'Telegram-focused preset with storage and notifications enabled.',
    channels: { telegram: true, wechat: false },
    capabilities: {
      skills: true,
      tools: true,
      mcp: false,
      'provider-profiles': true,
      'storage-adapter': true,
      'image-relay': false,
      'notification-adapter': true,
    },
  },
  {
    key: 'wechat-only',
    description: 'WeChat-focused preset with image relay and storage enabled.',
    channels: { telegram: false, wechat: true },
    capabilities: {
      skills: true,
      tools: true,
      mcp: false,
      'provider-profiles': true,
      'storage-adapter': true,
      'image-relay': true,
      'notification-adapter': true,
    },
  },
  {
    key: 'social',
    description: 'Telegram + WeChat social channels with all supported social capabilities.',
    channels: { telegram: true, wechat: true },
    capabilities: {
      skills: true,
      tools: true,
      mcp: true,
      'provider-profiles': true,
      'storage-adapter': true,
      'image-relay': true,
      'notification-adapter': true,
    },
  },
] as const

export function listPresets(): readonly PresetDefinition[] {
  return PRESETS
}

export function getPreset(key: string): PresetDefinition | null {
  return PRESETS.find(preset => preset.key === key) ?? null
}
