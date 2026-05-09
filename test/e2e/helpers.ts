import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type CliResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export type CliOptions = {
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
}

export function createTempHome(): string {
  return mkdtempSync(join(tmpdir(), 'codex-app-e2e-'))
}

export function cleanupTempHome(path: string): void {
  rmSync(path, { recursive: true, force: true })
}

export async function runCli(args: readonly string[], options: CliOptions): Promise<CliResult> {
  const proc = Bun.spawn(
    ['bun', 'run', 'packages/cli/src/main.ts', ...args],
    {
      cwd: options.cwd,
      env: options.env,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited

  return { exitCode, stdout, stderr }
}

export async function runCliJson<T>(args: readonly string[], options: CliOptions): Promise<T> {
  const result = await runCli(['--json', ...args], options)
  if (result.exitCode !== 0) {
    throw new Error(`CLI failed (${result.exitCode}): ${result.stderr || result.stdout}`)
  }
  return JSON.parse(result.stdout) as T
}

export async function waitForHttp(url: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // Ignore and retry
    }
    await Bun.sleep(80)
  }
  throw new Error(`timeout waiting for HTTP: ${url}`)
}

export async function nextFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number })?.port
      server.close(() => resolve(port))
    })
    server.once('error', reject)
  })
}

export async function waitForWebSocketMessage(
  ws: WebSocket,
  predicate: (payload: unknown) => boolean,
  timeoutMs = 5000,
): Promise<unknown> {
  return await new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.removeEventListener('message', onMessage)
      reject(new Error('timeout waiting for websocket message'))
    }, timeoutMs)
    const onMessage = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(typeof event.data === 'string' ? event.data : '')
        if (predicate(payload)) {
          clearTimeout(timeout)
          ws.removeEventListener('message', onMessage)
          resolve(payload)
        }
      } catch {
        // ignore malformed
      }
    }
    ws.addEventListener('message', onMessage)
  })
}

export async function waitForWebSocketResponse(
  ws: WebSocket,
  id: number,
  timeoutMs = 5000,
): Promise<{ id: number; result?: unknown; error?: { message?: string; code?: number } }> {
  const payload = await waitForWebSocketMessage(ws, (value: unknown) => {
    if (typeof value !== 'object' || value === null) return false
    const body = value as Record<string, unknown>
    return body.id === id
  }, timeoutMs)
  return payload as {
    id: number
    result?: unknown
    error?: { message?: string; code?: number }
  }
}
