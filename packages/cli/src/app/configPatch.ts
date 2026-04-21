import type { AppConfig, CapabilityKey, ChannelKey } from '@codex-app/core'
import type { PresetDefinition } from '@codex-app/core'

const SECRET_KEYS = new Set(['token', 'botToken', 'adminToken', 'authorization', 'apiKey'])

export function sanitizeConfig(config: AppConfig): Omit<AppConfig, 'telegram' | 'wechat'> {
  const { telegram: _telegram, wechat: _wechat, ...rest } = config
  return redactSecrets(rest) as Omit<AppConfig, 'telegram' | 'wechat'>
}

export function redactPathValue(path: string, value: unknown): unknown {
  const last = path.split('.').pop() ?? ''
  if (SECRET_KEYS.has(last)) {
    return redactSecretValue(value)
  }
  return redactSecrets(value)
}

export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => redactSecrets(item)) as T
  }
  if (value === null || value === undefined || typeof value !== 'object') {
    return value
  }

  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEYS.has(key)) {
      output[key] = redactSecretValue(entry)
      continue
    }
    output[key] = redactSecrets(entry)
  }
  return output as T
}

function redactSecretValue(value: unknown): unknown {
  if (typeof value !== 'string') return '[REDACTED]'
  const trimmed = value.trim()
  if (trimmed.length <= 6) return '[REDACTED]'
  return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`
}

function setChannelEnabled(config: AppConfig, key: ChannelKey, enabled: boolean): AppConfig {
  if (key === 'web') {
    return {
      ...config,
      channels: {
        ...config.channels,
        web: { ...config.channels.web, enabled },
      },
    }
  }
  if (key === 'telegram') {
    return {
      ...config,
      channels: {
        ...config.channels,
        telegram: { ...config.channels.telegram, enabled },
      },
    }
  }
  return {
    ...config,
    channels: {
      ...config.channels,
      wechat: { ...config.channels.wechat, enabled },
    },
  }
}

function setCapabilityEnabled(config: AppConfig, key: CapabilityKey, enabled: boolean): AppConfig {
  return {
    ...config,
    capabilities: {
      ...config.capabilities,
      [key]: {
        ...config.capabilities[key],
        enabled,
      },
    },
  }
}

export function applyPresetConfig(config: AppConfig, preset: PresetDefinition): AppConfig {
  let next = config
  for (const [key, enabled] of Object.entries(preset.channels) as [ChannelKey, boolean][]) {
    next = setChannelEnabled(next, key, enabled)
  }
  for (const [key, enabled] of Object.entries(preset.capabilities) as [CapabilityKey, boolean][]) {
    next = setCapabilityEnabled(next, key, enabled)
  }
  return next
}

export function applyCustomConfig(
  config: AppConfig,
  channels: readonly [ChannelKey, boolean][],
  capabilities: readonly [CapabilityKey, boolean][],
): AppConfig {
  let next = config
  for (const [key, enabled] of channels) {
    next = setChannelEnabled(next, key, enabled)
  }
  for (const [key, enabled] of capabilities) {
    next = setCapabilityEnabled(next, key, enabled)
  }
  return next
}

export function readPath(target: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== 'object') return undefined
    return (acc as Record<string, unknown>)[key]
  }, target)
}

export function mergePatch<T>(target: T, patch: unknown): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return patch as T
  }
  if (target === null || typeof target !== 'object' || Array.isArray(target)) {
    return patch as T
  }
  const source = target as Record<string, unknown>
  const delta = patch as Record<string, unknown>
  const output: Record<string, unknown> = { ...source }
  for (const [key, value] of Object.entries(delta)) {
    output[key] = key in source ? mergePatch(source[key], value) : value
  }
  return output as T
}
