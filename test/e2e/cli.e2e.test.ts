import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createTempHome, cleanupTempHome, runCliJson } from '@e2e/helpers'

type CliResponse = {
  readonly ok: boolean
  readonly command: string
  readonly data?: Record<string, unknown> | unknown[]
  readonly message?: string
}

describe('cli e2e', () => {
  let home: string

  beforeEach(() => {
    home = createTempHome()
  })

  afterEach(() => {
    cleanupTempHome(home)
  })

  test('doctor shows runtime metadata', async () => {
    const doctor = await runCliJson<CliResponse>(['doctor'], {
      cwd: process.cwd(),
      env: { ...process.env, CODEX_APP_HOME: home, HOME: home },
    })

    expect(doctor.ok).toBe(true)
    expect(doctor.command).toBe('doctor')
    expect(doctor.data).toHaveProperty('configPath', `${home}/config.json`)
    expect(doctor.data).toHaveProperty('cwd', process.cwd())
  })

  test('initialize and inspect config lifecycle', async () => {
    const init = await runCliJson<CliResponse>(['init'], {
      cwd: process.cwd(),
      env: { ...process.env, CODEX_APP_HOME: home },
    })

    expect(init.ok).toBe(true)
    expect(init.command).toBe('init')
    const createdConfig = (init.data as { config?: Record<string, unknown> })?.config ?? {}
    expect(createdConfig).toHaveProperty('users')

    const view = await runCliJson<CliResponse>(['config', 'view'], {
      cwd: process.cwd(),
      env: { ...process.env, CODEX_APP_HOME: home },
    })

    expect(view.ok).toBe(true)
    expect(view.command).toBe('config view')
    expect(view.data).toBeDefined()
    expect(view.data).not.toBeNull()
    expect((view.data as Record<string, unknown>)).not.toHaveProperty('telegram')
    expect(view.data).toHaveProperty('channels.web.enabled', true)
    expect(view.data).toHaveProperty('users.0.name', 'admin')
    expect(view.data).toHaveProperty('tokens.0.label', 'auto-generated')

    const getToken = await runCliJson<CliResponse>(['config', 'get', 'tokens.0.userId'], {
      cwd: process.cwd(),
      env: { ...process.env, CODEX_APP_HOME: home },
    })
    expect(getToken.ok).toBe(true)
    expect(typeof (getToken.data as string)).toBe('string')
  })

  test('assemble and catalog commands should be stable end-to-end', async () => {
    await runCliJson<CliResponse>(['init'], {
      cwd: process.cwd(),
      env: { ...process.env, CODEX_APP_HOME: home },
    })

    const dryRun = await runCliJson<CliResponse>([
      'assemble',
      'apply',
      'custom',
      '--channel',
      'telegram=off',
      '--capability',
      'mcp=off',
      '--dry-run',
    ], {
      cwd: process.cwd(),
      env: { ...process.env, CODEX_APP_HOME: home },
    })

    expect(dryRun.ok).toBe(true)
    expect(dryRun.data?.config).toHaveProperty('channels.telegram.enabled', false)
    expect(dryRun.data?.config).toHaveProperty('capabilities.mcp.enabled', false)

    const apply = await runCliJson<CliResponse>([
      'assemble',
      'apply',
      'web-only',
    ], {
      cwd: process.cwd(),
      env: { ...process.env, CODEX_APP_HOME: home },
    })
    expect(apply.ok).toBe(true)

    const channels = await runCliJson<CliResponse>(['channel', 'show', 'web'], {
      cwd: process.cwd(),
      env: { ...process.env, CODEX_APP_HOME: home },
    })
    expect(channels.ok).toBe(true)
    expect(channels.data).toHaveProperty('key', 'web')

    const capabilities = await runCliJson<CliResponse>(['capability', 'show', 'tools'], {
      cwd: process.cwd(),
      env: { ...process.env, CODEX_APP_HOME: home },
    })
    expect(capabilities.ok).toBe(true)
    expect(capabilities.data).toHaveProperty('key', 'tools')

    const preset = await runCliJson<CliResponse>(['preset', 'show', 'web-only'], {
      cwd: process.cwd(),
      env: { ...process.env, CODEX_APP_HOME: home },
    })
    expect(preset.ok).toBe(true)
    expect(preset.data).toHaveProperty('key', 'web-only')
  })
})
