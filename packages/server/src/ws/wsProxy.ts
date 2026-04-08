import type {
  CodexClient,
  CodexNotification,
  NotificationHub,
  SessionManager,
  ChannelSink,
} from '@codex-app/core'

export type WsData = {
  readonly userId: string
  readonly userName: string
  readonly tokenLabel?: string
}

type WsConn = ServerWebSocket<WsData>

type JsonRpcRequest = {
  readonly id?: number | string | null
  readonly method: string
  readonly params?: Record<string, unknown>
}

// Methods that require the caller to own the referenced session
const OWNED_METHODS = new Set([
  'thread/resume',
  'thread/read',
  'thread/archive',
  'thread/compact/start',
  'turn/start',
  'turn/interrupt',
  'turn/steer',
])

export class WsProxy {
  // Per-connection map: sessionId → ChannelSink, keyed by ws object
  private readonly connSinks = new WeakMap<WsConn, Map<string, ChannelSink>>()

  constructor(
    private readonly codex: CodexClient,
    private readonly sessions: SessionManager,
    private readonly hub: NotificationHub,
  ) {}

  open(ws: WsConn): void {
    const { userId, userName } = ws.data
    console.log(`[ws] Connected: ${userName} (${userId})`)

    // Subscribe to notifications for all pre-existing sessions of this user
    for (const s of this.sessions.listSessions(userId)) {
      this.subscribe(ws, s.sessionId)
    }
  }

  async message(ws: WsConn, raw: string | Buffer): Promise<void> {
    const { userId } = ws.data
    let msg: JsonRpcRequest

    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString()) as JsonRpcRequest
    } catch {
      ws.send(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } }))
      return
    }

    console.log(`[ws] ${userId} → ${msg.method}`)

    if (!this.checkOwnership(ws, msg)) return

    try {
      const result = await this.codex.call(msg.method, msg.params ?? {})
      this.postCall(ws, userId, msg, result)
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal error'
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32603, message },
      }))
    }
  }

  close(ws: WsConn): void {
    const { userId, userName } = ws.data
    console.log(`[ws] Disconnected: ${userName} (${userId})`)
    this.unsubscribeAll(ws)
  }

  // Returns false and sends error if ownership check fails
  private checkOwnership(ws: WsConn, msg: JsonRpcRequest): boolean {
    if (!OWNED_METHODS.has(msg.method)) return true

    const threadId = msg.params?.threadId as string | undefined
    if (!threadId) return true

    const { userId } = ws.data
    if (this.sessions.listSessions(userId).some(s => s.sessionId === threadId)) return true

    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      error: { code: -32403, message: 'Forbidden: session not owned by this user' },
    }))
    return false
  }

  // Register new sessions and update notification subscriptions after a successful call
  private postCall(ws: WsConn, userId: string, msg: JsonRpcRequest, result: unknown): void {
    if (msg.method === 'thread/start') {
      const res = result as { threadId?: string } | null
      if (res?.threadId) {
        const projectDir = (msg.params?.cwd as string) ?? ''
        this.sessions.registerSession(userId, res.threadId, projectDir)
        this.subscribe(ws, res.threadId)
      }
      return
    }

    if (msg.method === 'thread/resume') {
      const threadId = msg.params?.threadId as string | undefined
      if (threadId) this.subscribe(ws, threadId)
    }
  }

  private subscribe(ws: WsConn, sessionId: string): void {
    const connMap = this.connSinks.get(ws) ?? new Map<string, ChannelSink>()
    if (connMap.has(sessionId)) return  // already subscribed

    const sink: ChannelSink = {
      type: 'ws',
      id: sessionId,
      send: (n: CodexNotification) => {
        if (ws.readyState === 1) {  // WebSocket.OPEN
          ws.send(JSON.stringify(n))
        }
      },
    }

    this.hub.subscribe(sessionId, sink)
    connMap.set(sessionId, sink)
    this.connSinks.set(ws, connMap)
  }

  private unsubscribeAll(ws: WsConn): void {
    const connMap = this.connSinks.get(ws)
    if (!connMap) return
    for (const [sessionId, sink] of connMap) {
      this.hub.unsubscribeSink(sessionId, sink)
    }
    this.connSinks.delete(ws)
  }
}
