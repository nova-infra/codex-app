import type { ChannelKey } from '@/registry/channelRegistry'
import type { CapabilityKey } from '@/registry/capabilityRegistry'

export type PresetKey = 'minimal' | 'web-only' | 'wechat-only' | 'full'

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
    channels: { web: false, telegram: false, wechat: false },
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
    key: 'web-only',
    description: 'Default mainline preset focused on web parity.',
    channels: { web: true, telegram: false, wechat: false },
    capabilities: {
      skills: true,
      tools: true,
      mcp: true,
      'provider-profiles': true,
      'storage-adapter': true,
      'image-relay': false,
      'notification-adapter': true,
    },
  },
  {
    key: 'wechat-only',
    description: 'WeChat-focused preset with image relay and storage enabled.',
    channels: { web: false, telegram: false, wechat: true },
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
    key: 'full',
    description: 'Web + Telegram + WeChat with all supported capabilities.',
    channels: { web: true, telegram: true, wechat: true },
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
