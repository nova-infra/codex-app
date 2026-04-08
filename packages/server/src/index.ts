import { loadConfig, CodexClient, TokenGuard, SessionManager, NotificationHub } from '@codex-app/core'

const config = loadConfig()

console.log(`[codex-app] Loading config from ~/.codex-app/config.json`)
console.log(`[codex-app] Port: ${config.port}, Codex port: ${config.codex.port}`)
console.log(`[codex-app] Tokens: ${config.tokens.map(t => t.label ?? t.token).join(', ') || '(none)'}`)

// Auth
const tokenGuard = new TokenGuard(config.tokens)

// Bridge
const codex = new CodexClient(config.codex.port, {
  approvalPolicy: config.codex.approvalPolicy,
  sandbox: config.codex.sandbox,
})

console.log(`[codex-app] Starting codex app-server on ws://127.0.0.1:${config.codex.port}...`)
await codex.start()
console.log(`[codex-app] Codex app-server connected`)

// Session & Notification
const sessionManager = new SessionManager(codex)
const notificationHub = new NotificationHub(codex)
notificationHub.start()

// HTTP + WS Server
const server = Bun.serve({
  port: config.port,

  fetch(req, server) {
    const url = new URL(req.url)

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        codex: codex.isConnected,
      }), { headers: { 'content-type': 'application/json' } })
    }

    // WebSocket upgrade
    if (url.pathname === '/ws') {
      const token = url.searchParams.get('token')
      const user = tokenGuard.verify(token)
      if (!user) {
        return new Response('Unauthorized', { status: 401 })
      }
      const upgraded = server.upgrade(req, { data: { token: user.token, label: user.label } })
      if (!upgraded) {
        return new Response('WebSocket upgrade failed', { status: 500 })
      }
      return undefined
    }

    // Telegram webhook
    if (url.pathname === '/webhook/telegram' && req.method === 'POST') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      })
    }

    // WeChat webhook
    if (url.pathname === '/webhook/wechat' && req.method === 'POST') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      })
    }

    return new Response('Not Found', { status: 404 })
  },

  websocket: {
    open(ws) {
      const { token, label } = ws.data as { token: string; label?: string }
      console.log(`[ws] Connected: ${label ?? token}`)
    },

    message(ws, raw) {
      // TODO: JSON-RPC proxy to codex
      const { token } = ws.data as { token: string }
      try {
        const msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString())
        console.log(`[ws] ${token} → ${msg.method ?? 'unknown'}`)

        // Forward to codex
        codex.call(msg.method, msg.params).then((result) => {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }))
        }).catch((err: Error) => {
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: -1, message: err.message },
          }))
        })
      } catch {
        ws.send(JSON.stringify({ error: 'invalid JSON' }))
      }
    },

    close(ws) {
      const { token, label } = ws.data as { token: string; label?: string }
      console.log(`[ws] Disconnected: ${label ?? token}`)
    },
  },
})

console.log(`[codex-app] Ready at http://localhost:${server.port}`)
console.log(`[codex-app] WebSocket: ws://localhost:${server.port}/ws?token=<your-token>`)
