import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cleanupTempHome, createTempHome, nextFreePort, waitForHttp, waitForWebSocketMessage, waitForWebSocketResponse } from '@e2e/helpers'

type AppConfig = {
  readonly port: number
  readonly codex: {
    readonly port: number
    readonly model: string
    readonly approvalPolicy: string
    readonly sandbox: string
  }
  readonly users: readonly { readonly id: string; readonly name: string }[]
  readonly tokens: readonly { readonly token: string; readonly userId: string; readonly label: string }[]
  readonly channels: {
    readonly web: { readonly enabled: boolean; readonly transport: 'ws' }
    readonly telegram: { readonly enabled: boolean; readonly botToken: string; readonly renderMode: 'classic' | 'hermes' }
    readonly wechat: { readonly enabled: boolean }
  }
  readonly capabilities: Record<string, { readonly enabled: boolean }>
  readonly runtime: {
    readonly gateway: { readonly transport: 'ws' }
    readonly codex: { readonly transport: 'app-server-ws' }
    readonly policy: { readonly autoCompact: { readonly enabled: boolean; readonly mode: 'manual' | 'suggest' | 'automatic'; readonly thresholdRatio: number } }
  }
  readonly streaming: { readonly enabled: boolean; readonly editIntervalMs: number; readonly minChars: number; readonly maxChars: number; readonly idleMs: number }
}

type WsRpcReply = { readonly id: number; readonly result?: unknown; readonly error?: { readonly message?: string; readonly code?: number } }

type WsServerProcess = {
  readonly proc: Bun.Subprocess<'' | 'pipe', 'inherit', 'inherit'>
  readonly stop: () => Promise<void>
}

function createServerConfig(port: number, codexPort: number): AppConfig {
  return {
    port,
    codex: {
      port: codexPort,
      model: 'o3',
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
    },
    users: [{ id: 'u-admin', name: 'admin' }, { id: 'u-guest', name: 'guest' }],
    tokens: [
      { token: 'admin-token', userId: 'u-admin', label: 'admin' },
      { token: 'guest-token', userId: 'u-guest', label: 'guest' },
    ],
    channels: {
      web: { enabled: true, transport: 'ws' },
      telegram: { enabled: false, botToken: '', renderMode: 'classic' },
      wechat: { enabled: false },
    },
    capabilities: {
      skills: { enabled: true },
      tools: { enabled: true },
      mcp: { enabled: false },
      'provider-profiles': { enabled: true },
      'storage-adapter': { enabled: true },
      'image-relay': { enabled: false },
      'notification-adapter': { enabled: true },
    },
    runtime: {
      gateway: { transport: 'ws' },
      codex: { transport: 'app-server-ws' },
      policy: {
        autoCompact: {
          enabled: true,
          mode: 'suggest',
          thresholdRatio: 0.8,
        },
      },
    },
    streaming: { enabled: true, editIntervalMs: 2000, minChars: 80, maxChars: 2000, idleMs: 600 },
  }
}

function createConfigFile(home: string, config: AppConfig): void {
  writeFileSync(join(home, 'config.json'), `${JSON.stringify(config, null, 2)}\n`)
}

async function startServer(home: string, config: AppConfig): Promise<WsServerProcess> {
  createConfigFile(home, config)
  const fixturePath = join(process.cwd(), 'test/e2e/fixtures')
  const proc = Bun.spawn(
    ['bun', 'run', 'packages/server/src/index.ts'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CODEX_APP_HOME: home,
        HOME: home,
        OPENAI_API_KEY: 'e2e-key',
        PATH: `${fixturePath}:${process.env.PATH ?? ''}`,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )

  try {
    await waitForHttp(`http://127.0.0.1:${config.port}/health`)
  } catch (error) {
    const out = await new Response(proc.stdout).text()
    const err = await new Response(proc.stderr).text()
    proc.kill('SIGKILL')
    await proc.exited
    throw new Error(`server failed to start: ${error}\nstdout:\n${out}\nstderr:\n${err}`)
  }

  const stop = async () => {
    proc.kill('SIGTERM')
    await Promise.race([
      proc.exited,
      Bun.sleep(1500).then(() => {
        proc.kill('SIGKILL')
        return proc.exited
      }),
    ])
  }
  return { proc, stop }
}

function openSocket(port: number, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`)
    ws.addEventListener('open', () => resolve(ws))
    ws.addEventListener('error', (err) => reject(new Error(`ws error: ${String(err)}`)))
  })
}

function sendWs(ws: WebSocket, id: number, method: string, params: Record<string, unknown>): void {
  ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
}

describe('server e2e', () => {
  let home: string
  let webPort: number
  let codexPort: number
  let server: WsServerProcess

  beforeEach(async () => {
    home = createTempHome()
    webPort = await nextFreePort()
    codexPort = await nextFreePort()
    server = await startServer(home, createServerConfig(webPort, codexPort))
  })

  afterEach(async () => {
    await server.stop()
    cleanupTempHome(home)
  })

  test('health, version, and websocket authorization', async () => {
    const denied = await fetch(`http://127.0.0.1:${webPort}/ws?token=bad`)
    expect(denied.status).toBe(401)

    const health = await (await fetch(`http://127.0.0.1:${webPort}/health`)).json() as { status: string; codex: boolean }
    expect(health.status).toBe('ok')
    expect(health.codex).toBe(true)

    const version = await (await fetch(`http://127.0.0.1:${webPort}/version`)).json() as { version: string }
    expect(version).toHaveProperty('version')
  })

  test('websocket thread lifecycle and ownership constraints', async () => {
    const adminSocket = await openSocket(webPort, 'admin-token')
    const guestSocket = await openSocket(webPort, 'guest-token')

    sendWs(adminSocket, 1, 'thread/start', { cwd: '/tmp/project' })
    const startResp = await waitForWebSocketResponse(adminSocket, 1)
    expect(startResp).toHaveProperty('result')
    const threadId = (startResp.result as { threadId?: string })?.threadId ?? ''
    expect(threadId.length).toBeGreaterThan(0)

    sendWs(adminSocket, 2, 'thread/list', { limit: 10 })
    const listResp = await waitForWebSocketResponse(adminSocket, 2)
    const listRows = (listResp.result as { data?: Array<{ id: string }> }).data ?? []
    expect(listRows.some(row => row.id === threadId)).toBe(true)

    sendWs(adminSocket, 3, 'thread/read', { threadId })
    const readResp = await waitForWebSocketResponse(adminSocket, 3)
    expect(readResp).toHaveProperty('result')
    const readPayload = readResp.result as { thread?: { id?: string; cwd?: string } }
    expect(readPayload.thread?.id).toBe(threadId)
    expect(readPayload.thread?.cwd).toBe('/tmp/project')

    sendWs(adminSocket, 4, 'turn/start', { threadId, input: [{ type: 'text', text: 'ping' }] })
    const turnResp = await waitForWebSocketResponse(adminSocket, 4)
    expect(turnResp.result).toMatchObject({ ok: true, method: 'turn/start' })

    const runtimeEvent = await waitForWebSocketMessage(adminSocket, payload => {
      if (!payload || typeof payload !== 'object') return false
      const event = payload as Record<string, unknown>
      return event.method === 'runtime/event'
        && typeof event.params === 'object'
        && event.params !== null
        && (event.params as { method?: string }).method === 'turn/completed'
    }, 8000)
    expect((runtimeEvent as Record<string, unknown>).method).toBe('runtime/event')

    sendWs(guestSocket, 1, 'thread/read', { threadId })
    const guestRead = await waitForWebSocketResponse(guestSocket, 1)
    expect(guestRead.error?.message).toContain('Forbidden: session not owned by this user')

    adminSocket.close()
    guestSocket.close()
  })
})
