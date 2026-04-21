import type { CommandResult } from '../app/output'
import {
  allCapabilities,
  allChannels,
  allPresets,
  getCapabilityOrThrow,
  getChannelOrThrow,
  getPresetOrThrow,
} from '../app/context'

export async function runPreset(args: readonly string[]): Promise<CommandResult> {
  const action = args[0] ?? 'list'
  if (action === 'list') {
    return {
      ok: true,
      command: 'preset list',
      data: allPresets(),
      message: allPresets().map(preset => `${preset.key}\t${preset.description}`).join('\n'),
    }
  }
  if (action === 'show') {
    const name = args[1] ?? ''
    const preset = getPresetOrThrow(name)
    return {
      ok: true,
      command: 'preset show',
      data: preset,
      message: `${preset.key}: ${preset.description}`,
    }
  }
  throw new Error(`Unsupported preset action: ${action}`)
}

export async function runChannel(args: readonly string[]): Promise<CommandResult> {
  const action = args[0] ?? 'list'
  if (action === 'list') {
    return {
      ok: true,
      command: 'channel list',
      data: allChannels(),
      message: allChannels().map(channel => `${channel.key}\t${channel.description}`).join('\n'),
    }
  }
  if (action === 'show') {
    const key = args[1] ?? ''
    const channel = getChannelOrThrow(key)
    return {
      ok: true,
      command: 'channel show',
      data: channel,
      message: `${channel.key}: ${channel.description}`,
    }
  }
  throw new Error(`Unsupported channel action: ${action}`)
}

export async function runCapability(args: readonly string[]): Promise<CommandResult> {
  const action = args[0] ?? 'list'
  if (action === 'list') {
    return {
      ok: true,
      command: 'capability list',
      data: allCapabilities(),
      message: allCapabilities().map(capability => `${capability.key}\t${capability.description}`).join('\n'),
    }
  }
  if (action === 'show') {
    const key = args[1] ?? ''
    const capability = getCapabilityOrThrow(key)
    return {
      ok: true,
      command: 'capability show',
      data: capability,
      message: `${capability.key}: ${capability.description}`,
    }
  }
  throw new Error(`Unsupported capability action: ${action}`)
}
