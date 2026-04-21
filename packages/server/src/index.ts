import {
  bootstrapConfig,
  CodexClient,
  TokenGuard,
  NotificationHub,
  SessionControlService,
  SessionPolicyEngine,
  EventPipeline,
  ContractRouter,
  type AppConfig,
} from '@codex-app/core'
import { execFileSync } from 'node:child_process'
import { start as startTelegramChannel } from '@codex-app/channel-telegram'
import { start as startWechatChannel } from '@codex-app/channel-wechat'
import serverPkg from '../package.json' with { type: 'json' }
import { WsProxy, type WsData } from './ws/wsProxy'

const { config, created, adminToken } = await bootstrapConfig()
const serviceVersion = serverPkg.version
const gitSha = resolveGitSha()
const gitDirty = resolveGitDirty()

console.log(`[codex-app] Loading config from ~/.codex-app/config.json`)
console.log(`[codex-app] Version: ${serviceVersion}${gitSha ? ` (${gitSha}${gitDirty ? '-dirty' : ''})` : ''}`)
console.log(`[codex-app] Port: ${config.port}, Codex port: ${config.codex.port}`)

if (created) {
  console.log(`[codex-app] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`[codex-app]   首次启动，已自动创建管理员`)
  console.log(`[codex-app]   用户: admin`)
  console.log(`[codex-app]   Token 已写入本地配置，请从 ~/.codex-app/config.json 查看`)
  console.log(`[codex-app] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
} else {
  console.log(`[codex-app] Users: ${config.users.map(u => u.name).join(', ') || '(none)'}`)
}

// Auth
const tokenGuard = new TokenGuard(config.users, config.tokens)

// Bridge
const codex = new CodexClient(config.codex.port, {
  approvalPolicy: config.codex.approvalPolicy,
  sandbox: config.codex.sandbox,
})

console.log(`[codex-app] Starting codex app-server on ws://127.0.0.1:${config.codex.port}...`)
await codex.start()
console.log(`[codex-app] Codex app-server connected`)

// Service layer
const sessionPolicy = new SessionPolicyEngine(config.runtime.policy.autoCompact)
const sessionControl = new SessionControlService(codex)
const eventPipeline = new EventPipeline(codex, sessionControl, sessionPolicy)
eventPipeline.start()

const notificationHub = new NotificationHub(eventPipeline)
notificationHub.start()
const contractRouter = new ContractRouter(codex, sessionControl)

// WS proxy
const wsProxy = new WsProxy(contractRouter, notificationHub)

// HTTP + WS server
const server = Bun.serve<WsData>({
  port: config.port,

  async fetch(req, server) {
    const url = new URL(req.url)

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        codex: codex.isConnected,
        version: serviceVersion,
        gitSha,
        gitDirty,
      }), { headers: { 'content-type': 'application/json' } })
    }

    if (url.pathname === '/version') {
      return new Response(JSON.stringify({
        name: serverPkg.name,
        version: serviceVersion,
        gitSha,
        gitDirty,
        codex: codex.isConnected,
      }), { headers: { 'content-type': 'application/json' } })
    }

    if (url.pathname === '/ws') {
      if (!config.channels.web.enabled) {
        return new Response('Web channel disabled', { status: 503 })
      }
      const token = url.searchParams.get('token')
      const user = tokenGuard.verify(token)
      if (!user) {
        return new Response('Unauthorized', { status: 401 })
      }
      const data: WsData = {
        userId: user.userId,
        userName: user.userName,
        tokenLabel: user.tokenLabel,
      }
      if (!server.upgrade(req, { data })) {
        return new Response('WebSocket upgrade failed', { status: 500 })
      }
      return undefined
    }

    return new Response('Not Found', { status: 404 })
  },

  websocket: {
    open(ws) { wsProxy.open(ws) },
    message(ws, raw) { void wsProxy.message(ws, raw) },
    close(ws) { wsProxy.close(ws) },
  },
})

console.log(`[codex-app] Ready at http://localhost:${server.port}`)
console.log(`[codex-app] WebSocket: ws://localhost:${server.port}/ws?token=<your-token>`)

// Start channel adapters (if configured)
await startChannels(config)

// ── Channel startup ──────────────────────────────────────────────────────────

type ChannelDeps = {
  readonly config: AppConfig
  readonly codex: CodexClient
  readonly sessionControl: SessionControlService
  readonly events: EventPipeline
  readonly hub: NotificationHub
  readonly tokenGuard: TokenGuard
}

async function startChannels(cfg: AppConfig): Promise<void> {
  const deps: ChannelDeps = {
    config: cfg,
    codex,
    sessionControl,
    events: eventPipeline,
    hub: notificationHub,
    tokenGuard,
  }

  if (cfg.channels.telegram.enabled && cfg.channels.telegram.botToken) {
    await startChannel('@codex-app/channel-telegram', startTelegramChannel, deps)
  }

  if (cfg.channels.wechat.enabled) {
    await startChannel('@codex-app/channel-wechat', startWechatChannel, deps)
  }
}

type StartChannelFn = (deps: ChannelDeps) => Promise<void>

async function startChannel(pkg: string, start: StartChannelFn, deps: ChannelDeps): Promise<void> {
  try {
    // Keep these channel entrypoints statically imported.
    // `bun build --compile` does not bundle the workspace packages behind
    // `await import('@codex-app/channel-*')`, so the compiled binary later
    // fails at runtime with "Cannot find module". This regression has already
    // happened more than once; do not switch this back to dynamic import unless
    // compiled runtime resolution is explicitly re-verified.
    await start(deps)
    console.log(`[codex-app] ${pkg} started`)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[codex-app] Failed to start ${pkg}: ${message}`)
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function resolveGitSha(): string | null {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    }).trim()
    return sha.length > 0 ? sha : null
  } catch {
    return null
  }
}

function resolveGitDirty(): boolean {
  try {
    const output = execFileSync('git', ['status', '--porcelain'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    }).trim()
    return output.length > 0
  } catch {
    return false
  }
}
