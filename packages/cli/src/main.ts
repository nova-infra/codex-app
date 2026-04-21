#!/usr/bin/env bun

import { runCapability, runChannel, runPreset } from './commands/catalog'
import { runAssemble, runConfig, runRequest } from './commands/config'
import { runDoctor, runInit, runRuntime } from './commands/runtime'
import { printError, printResult } from './app/output'

const HELP = [
  'codex-app <command>',
  '',
  'Commands:',
  '  doctor',
  '  init',
  '  preset list',
  '  preset show <name>',
  '  channel list',
  '  channel show <name>',
  '  capability list',
  '  capability show <name>',
  '  config view',
  '  config get <path>',
  '  assemble apply <preset> [--dry-run]',
  '  assemble apply custom --channel web=on --capability mcp=off [--dry-run]',
  '  runtime start',
  '  request config-patch --file <file> [--dry-run]',
].join('\n')

function splitFlags(argv: readonly string[]) {
  const json = argv.includes('--json')
  const help = argv.includes('--help') || argv.includes('-h')
  const args = argv.filter(arg => arg !== '--json' && arg !== '--help' && arg !== '-h')
  return { json, help, args }
}

async function main(): Promise<void> {
  const { json, help, args } = splitFlags(process.argv.slice(2))
  const command = args[0] ?? ''

  if (!command || help) {
    printResult({ ok: true, command: 'help', message: HELP }, json)
    return
  }

  try {
    const result = command === 'doctor'
      ? await runDoctor()
      : command === 'init'
        ? await runInit()
        : command === 'preset'
          ? await runPreset(args.slice(1))
          : command === 'channel'
            ? await runChannel(args.slice(1))
            : command === 'capability'
              ? await runCapability(args.slice(1))
              : command === 'config'
                ? await runConfig(args.slice(1))
                : command === 'assemble'
                  ? await runAssemble(args.slice(1))
                  : command === 'runtime'
                    ? await runRuntime(args.slice(1))
                    : command === 'request'
                      ? await runRequest(args.slice(1))
                      : (() => { throw new Error(`Unknown command: ${command}`) })()

    printResult(result, json)
    if (!result.ok) process.exit(1)
  } catch (error) {
    printError(command, error, json)
    process.exit(1)
  }
}

await main()
