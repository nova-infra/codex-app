import type {
  ContractRouter,
  NotificationHub,
  ChannelSink,
  RuntimeEvent,
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

export class WsProxy {
  // Per-connection map: sessionId → ChannelSink, keyed by ws object
  private readonly connSinks = new WeakMap<WsConn, Map<string, ChannelSink>>()

  constructor(
    private readonly router: ContractRouter,
    private readonly hub: NotificationHub,
  ) {}

  open(ws: WsConn): void {
    const { userId, userName } = ws.data
    console.log(`[ws] Connected: ${userName} (${userId})`)
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

    try {
      const result = await this.router.route(userId, msg)
      await this.postCall(ws, userId, msg, result)
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

  // Register new sessions and update notification subscriptions after a successful call
  private async postCall(ws: WsConn, _userId: string, msg: JsonRpcRequest, result: unknown): Promise<void> {
    if (msg.method === 'thread/start') {
      const res = result as { threadId?: string } | null
      if (res?.threadId) {
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
      send: (event: RuntimeEvent) => {
        if (ws.readyState === 1) {  // WebSocket.OPEN
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            method: 'runtime/event',
            params: event,
          }))
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
