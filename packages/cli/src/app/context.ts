import {
  bootstrapConfig,
  getCapability,
  getChannel,
  getPreset,
  listCapabilities,
  listChannels,
  listPresets,
  loadConfig,
  saveConfig,
  type AppConfig,
  type CapabilityKey,
  type ChannelKey,
  type PresetDefinition,
} from '@codex-app/core'

export type CliContext = {
  readonly cwd: string
  readonly json: boolean
  readonly args: readonly string[]
}

export async function getConfig(): Promise<AppConfig> {
  return loadConfig()
}

export async function initConfig(): Promise<Awaited<ReturnType<typeof bootstrapConfig>>> {
  return bootstrapConfig()
}

export async function writeConfig(config: AppConfig): Promise<void> {
  await saveConfig(config)
}

export function getPresetOrThrow(name: string): PresetDefinition {
  const preset = getPreset(name)
  if (!preset) throw new Error(`Unknown preset: ${name}`)
  return preset
}

export function getChannelOrThrow(key: string) {
  const channel = getChannel(key)
  if (!channel) throw new Error(`Unknown channel: ${key}`)
  return channel
}

export function getCapabilityOrThrow(key: string) {
  const capability = getCapability(key)
  if (!capability) throw new Error(`Unknown capability: ${key}`)
  return capability
}

export function allPresets() {
  return listPresets()
}

export function allChannels() {
  return listChannels()
}

export function allCapabilities() {
  return listCapabilities()
}

export function isChannelKey(value: string): value is ChannelKey {
  return allChannels().some(channel => channel.key === value)
}

export function isCapabilityKey(value: string): value is CapabilityKey {
  return allCapabilities().some(capability => capability.key === value)
}
