import {
  bootstrapConfig,
  CodexClient,
  TokenGuard,
  SessionManager,
  NotificationHub,
  type AppConfig,
} from '@codex-app/core'
import { WsProxy, type WsData } from './ws/wsProxy'

const { config, created, adminToken } = bootstrapConfig()

console.log(`[codex-app] Loading config from ~/.codex-app/config.json`)
console.log(`[codex-app] Port: ${config.port}, Codex port: ${config.codex.port}`)

if (created) {
  console.log(`[codex-app] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`[codex-app]   首次启动，已自动创建管理员`)
  console.log(`[codex-app]   用户: admin`)
  console.log(`[codex-app]   Token: ${adminToken}`)
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
const sessionManager = new SessionManager(codex)
const notificationHub = new NotificationHub(codex)
notificationHub.start()

// WS proxy
const wsProxy = new WsProxy(codex, sessionManager, notificationHub)

// HTTP + WS server
const server = Bun.serve<WsData>({
  port: config.port,

  fetch(req, server) {
    const url = new URL(req.url)

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        codex: codex.isConnected,
      }), { headers: { 'content-type': 'application/json' } })
    }

    if (url.pathname === '/ws') {
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
  readonly sessions: SessionManager
  readonly hub: NotificationHub
}

type ChannelModule = {
  start?: (deps: ChannelDeps) => Promise<void>
}

async function startChannels(cfg: AppConfig): Promise<void> {
  const deps: ChannelDeps = { config: cfg, codex, sessions: sessionManager, hub: notificationHub }

  if (cfg.telegram?.botToken) {
    await startChannel('@codex-app/channel-telegram', deps)
  }

  if (cfg.wechat?.enabled) {
    await startChannel('@codex-app/channel-wechat', deps)
  }
}

async function startChannel(pkg: string, deps: ChannelDeps): Promise<void> {
  try {
    const mod = await import(pkg) as ChannelModule
    if (typeof mod.start === 'function') {
      await mod.start(deps)
      console.log(`[codex-app] ${pkg} started`)
    } else {
      console.log(`[codex-app] ${pkg} not yet implemented (stub)`)
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[codex-app] Failed to start ${pkg}: ${message}`)
  }
}
