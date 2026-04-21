import { getConfig, writeConfig, getPresetOrThrow, isCapabilityKey, isChannelKey } from '../app/context'
import { applyCustomConfig, applyPresetConfig, mergePatch, readPath, redactPathValue, sanitizeConfig } from '../app/configPatch'
import type { CommandResult } from '../app/output'
import type { CapabilityKey, ChannelKey } from '@codex-app/core'

function parseBooleanFlag(raw: string): boolean {
  return ['1', 'true', 'on', 'enabled', 'yes'].includes(raw.toLowerCase())
}

function parseAssignments(
  args: readonly string[],
  flag: '--channel' | '--capability',
): readonly string[] {
  const collected: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== flag) continue
    const value = args[index + 1] ?? ''
    if (value) collected.push(value)
  }
  return collected
}

export async function runConfig(args: readonly string[]): Promise<CommandResult> {
  const action = args[0] ?? 'view'
  const config = await getConfig()
  if (action === 'view') {
    return { ok: true, command: 'config view', data: sanitizeConfig(config) }
  }
  if (action === 'get') {
    const path = args[1] ?? ''
    if (!path) throw new Error('config get requires a dot path')
    const value = redactPathValue(path, readPath(config, path))
    return {
      ok: true,
      command: 'config get',
      data: value,
      message: `${path} = ${JSON.stringify(value)}`,
    }
  }
  throw new Error(`Unsupported config action: ${action}`)
}

export async function runAssemble(args: readonly string[]): Promise<CommandResult> {
  const action = args[0] ?? 'apply'
  if (action !== 'apply') throw new Error(`Unsupported assemble action: ${action}`)

  const target = args[1] ?? ''
  const dryRun = args.includes('--dry-run')
  const config = await getConfig()
  let next = config

  if (target === 'custom') {
    const channels = parseAssignments(args, '--channel').map((assignment) => {
      const [key, raw] = assignment.split('=')
      if (!isChannelKey(key)) throw new Error(`Unknown channel in custom assemble: ${key}`)
      return [key as ChannelKey, parseBooleanFlag(raw ?? 'false')] as const
    })
    const capabilities = parseAssignments(args, '--capability').map((assignment) => {
      const [key, raw] = assignment.split('=')
      if (!isCapabilityKey(key)) throw new Error(`Unknown capability in custom assemble: ${key}`)
      return [key as CapabilityKey, parseBooleanFlag(raw ?? 'false')] as const
    })
    next = applyCustomConfig(config, channels, capabilities)
  } else {
    next = applyPresetConfig(config, getPresetOrThrow(target))
  }

  if (!dryRun) await writeConfig(next)

  return {
    ok: true,
    command: 'assemble apply',
    data: { dryRun, config: sanitizeConfig(next) },
    message: dryRun ? 'Assemble dry-run completed.' : 'Assemble applied.',
  }
}

export async function runRequest(args: readonly string[]): Promise<CommandResult> {
  const action = args[0] ?? ''
  if (action !== 'config-patch') throw new Error(`Unsupported request action: ${action}`)

  const fileIndex = args.indexOf('--file')
  const filePath = fileIndex >= 0 ? args[fileIndex + 1] ?? '' : ''
  if (!filePath) throw new Error('request config-patch requires --file')
  const dryRun = args.includes('--dry-run')
  const config = await getConfig()
  const patch = JSON.parse(await Bun.file(filePath).text())
  const next = mergePatch(config, patch)
  if (!dryRun) await writeConfig(next)

  return {
    ok: true,
    command: 'request config-patch',
    data: { dryRun, config: sanitizeConfig(next) },
    message: dryRun ? 'Config patch dry-run completed.' : 'Config patch applied.',
  }
}
