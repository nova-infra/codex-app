import {
  bootstrapConfig,
  CodexClient,
  TokenGuard,
  SessionManager,
  NotificationHub,
  type AppConfig,
} from '@codex-app/core'
import { AccountManager, callbackRegistry } from '@codex-app/codex-account'
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
  console.log(`[codex-app]   Token: ${adminToken}`)
  console.log(`[codex-app] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
} else {
  console.log(`[codex-app] Users: ${config.users.map(u => u.name).join(', ') || '(none)'}`)
}

// Auth
const tokenGuard = new TokenGuard(config.users, config.tokens)

// Account management (writes ~/.codex/auth.json directly, no restart needed)
const accountManager = new AccountManager(config.port)
const importedExistingAccount = await accountManager.load()
if (importedExistingAccount) {
  console.log('[codex-app] Imported existing Codex login from ~/.codex/auth.json')
}

if (accountManager.hasAccounts()) {
  await accountManager.applyActiveKey()
}

const active = accountManager.getActiveAccount()
if (active) {
  console.log(`[codex-app] Using account: ${active.email} (${active.id})`)
}

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

    // ── Codex Account Management ─────────────────────────────────────────────

    // List accounts (masked)
    if (url.pathname === '/codex-account' && req.method === 'GET') {
      return jsonResponse({ success: true, data: accountManager.list() })
    }

    // Auth method 1: Login (browser OAuth) → returns authUrl
    if (url.pathname === '/codex-account/login' && req.method === 'POST') {
      const { authUrl, state } = await accountManager.initiateLogin()
      return jsonResponse({ success: true, data: { authUrl, state } })
    }

    // OAuth callback (browser redirect target)
    if (url.pathname === '/codex-account/callback' && req.method === 'GET') {
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      if (!code || !state) {
        return new Response('Missing code or state', { status: 400 })
      }
      try {
        const account = await accountManager.handleCallback(code, state)
        callbackRegistry.notifyLogin(state, account.email)
        return new Response(`<html><body><h2>Account added: ${account.email}</h2><p>You can close this tab.</p></body></html>`, {
          headers: { 'content-type': 'text/html' },
        })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return new Response(`<html><body><h2>Auth failed</h2><p>${message}</p></body></html>`, {
          status: 400,
          headers: { 'content-type': 'text/html' },
        })
      }
    }

    // Auth method 2+3: Authorization code or Refresh token
    if (url.pathname === '/codex-account/token' && req.method === 'POST') {
      const body = await req.json() as { code?: string; codeVerifier?: string; refreshToken?: string }
      try {
        let account
        if (body.refreshToken) {
          account = await accountManager.addByRefreshToken(body.refreshToken)
        } else if (body.code && body.codeVerifier) {
          account = await accountManager.addByCode(body.code, body.codeVerifier)
        } else {
          return jsonResponse({ success: false, error: 'Provide { refreshToken } or { code, codeVerifier }' }, 400)
        }
        return jsonResponse({ success: true, data: account })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return jsonResponse({ success: false, error: message }, 400)
      }
    }

    // Delete account
    if (url.pathname.startsWith('/codex-account/') && req.method === 'DELETE') {
      const id = url.pathname.slice('/codex-account/'.length)
      if (id.includes('/')) return new Response('Not Found', { status: 404 })
      const ok = await accountManager.remove(id)
      if (!ok) return jsonResponse({ success: false, error: 'account not found' }, 404)
      return jsonResponse({ success: true })
    }

    // Usage (5h / 1week)
    if (url.pathname.startsWith('/codex-account/') && url.pathname.endsWith('/usage') && req.method === 'GET') {
      const id = url.pathname.slice('/codex-account/'.length, -'/usage'.length)
      try {
        const usage = await accountManager.getUsage(id)
        return jsonResponse({ success: true, data: usage })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return jsonResponse({ success: false, error: message }, 400)
      }
    }

    // Switch active account
    if (url.pathname.startsWith('/codex-account/') && url.pathname.endsWith('/activate') && req.method === 'POST') {
      const id = url.pathname.slice('/codex-account/'.length, -'/activate'.length)
      const ok = await accountManager.switchTo(id)
      if (!ok) return jsonResponse({ success: false, error: 'account not found or disabled' }, 404)
      return jsonResponse({ success: true, message: 'auth.json updated' })
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
  readonly tokenGuard: TokenGuard
  readonly accountManager: AccountManager
}

async function startChannels(cfg: AppConfig): Promise<void> {
  const deps: ChannelDeps = { config: cfg, codex, sessions: sessionManager, hub: notificationHub, tokenGuard, accountManager }

  if (cfg.telegram?.botToken) {
    await startChannel('@codex-app/channel-telegram', startTelegramChannel, deps)
  }

  if (cfg.wechat?.enabled) {
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
