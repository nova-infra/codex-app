import { initConfig, getConfig } from '../app/context'
import type { CommandResult } from '../app/output'
import { redactSecrets } from '../app/configPatch'

export async function runDoctor(): Promise<CommandResult> {
  const config = await getConfig()
  return {
    ok: true,
    command: 'doctor',
    data: {
      cwd: process.cwd(),
      bun: Bun.version,
      serverEntry: 'packages/server/src/index.ts',
      configPath: process.env.HOME ? `${process.env.HOME}/.codex-app/config.json` : null,
      channels: redactSecrets(config.channels),
      capabilities: config.capabilities,
    },
    message: [
      `cwd: ${process.cwd()}`,
      `bun: ${Bun.version}`,
      `server: packages/server/src/index.ts`,
    ].join('\n'),
  }
}

export async function runInit(): Promise<CommandResult> {
  const result = await initConfig()
  return {
    ok: true,
    command: 'init',
    data: result,
    message: result.created ? 'Config initialized.' : 'Config already exists.',
  }
}

export async function runRuntime(args: readonly string[]): Promise<CommandResult> {
  const action = args[0] ?? 'start'
  if (action !== 'start') throw new Error(`Unsupported runtime action: ${action}`)
  await import('../../../server/src/index.ts')
  return {
    ok: true,
    command: 'runtime start',
    message: 'runtime started',
  }
}
