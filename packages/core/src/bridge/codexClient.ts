import { spawn, type ChildProcess } from 'node:child_process'

type JsonRpcMessage = {
  readonly jsonrpc: '2.0'
  readonly id?: number
  readonly method?: string
  readonly params?: unknown
  readonly result?: unknown
  readonly error?: { readonly code: number; readonly message: string }
}

export type CodexNotification = {
  readonly method: string
  readonly params: unknown
}

type PendingCall = {
  readonly resolve: (value: unknown) => void
  readonly reject: (reason: Error) => void
}

export class CodexClient {
  private ws: WebSocket | null = null
  private codexProcess: ChildProcess | null = null
  private nextId = 1
  private initialized = false
  private readonly pending = new Map<number, PendingCall>()
  private readonly listeners = new Set<(n: CodexNotification) => void>()

  constructor(
    private readonly codexPort: number,
    private readonly codexConfig: {
      readonly approvalPolicy: string
      readonly sandbox: string
    },
  ) {}

  async start(): Promise<void> {
    await this.spawnCodexServer()
    await this.connect()
    await this.initialize()
  }

  private spawnCodexServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        'app-server',
        '--listen', `ws://127.0.0.1:${this.codexPort}`,
        '-c', `approval_policy="${this.codexConfig.approvalPolicy}"`,
        '-c', `sandbox_mode="${this.codexConfig.sandbox}"`,
      ]

      this.codexProcess = spawn('codex', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let started = false

      this.codexProcess.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        if (!started && (text.includes('listening') || text.includes('Listening'))) {
          started = true
          resolve()
        }
      })

      this.codexProcess.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        if (!started && (text.includes('listening') || text.includes('Listening'))) {
          started = true
          resolve()
        }
      })

      this.codexProcess.on('error', reject)
      this.codexProcess.on('exit', (code) => {
        if (!started) {
          reject(new Error(`codex app-server exited with code ${code}`))
        }
      })

      // Fallback: if no "listening" message, wait and try connecting
      setTimeout(() => {
        if (!started) {
          started = true
          resolve()
        }
      }, 3000)
    })
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `ws://127.0.0.1:${this.codexPort}`
      this.ws = new WebSocket(url)

      this.ws.onopen = () => resolve()
      this.ws.onerror = (e) => reject(new Error(`WebSocket error: ${e}`))

      this.ws.onmessage = (event) => {
        const raw = event.data
        const text = typeof raw === 'string' ? raw
          : raw instanceof Buffer ? raw.toString('utf-8')
          : raw instanceof ArrayBuffer ? new TextDecoder().decode(raw)
          : String(raw)
        for (const line of text.split('\n')) {
          const trimmed = line.trim()
          if (trimmed.length > 0) {
            this.handleMessage(trimmed)
          }
        }
      }

      this.ws.onclose = () => {
        for (const p of this.pending.values()) {
          p.reject(new Error('codex app-server connection closed'))
        }
        this.pending.clear()
        this.ws = null
        this.initialized = false
      }
    })
  }

  private handleMessage(raw: string): void {
    let msg: JsonRpcMessage
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }

    // Response to our call
    if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!
      this.pending.delete(msg.id)
      if (msg.error) {
        p.reject(new Error(msg.error.message))
      } else {
        p.resolve(msg.result)
      }
      return
    }

    // Notification (no id) or server request (has id + method)
    if (typeof msg.method === 'string') {
      if (!msg.method.startsWith('mcpServer/')) {
        console.log(`[codex-ws] ${new Date().toISOString()} ${msg.method}`)
      }
      // Server request (has both id and method) — needs reply
      if (typeof msg.id === 'number') {
        this.emit({ method: msg.method, params: { ...((msg.params ?? {}) as Record<string, unknown>), _requestId: msg.id } })
      } else {
        this.emit({ method: msg.method, params: msg.params ?? null })
      }
    }
  }

  private async initialize(): Promise<void> {
    await this.call('initialize', {
      clientInfo: { name: 'codex-app', version: '0.1.0' },
    })
    this.initialized = true
    this.send({ method: 'initialized', params: {} })
  }

  async call(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  reply(id: number, result: unknown): void {
    this.send({ jsonrpc: '2.0', id, result })
  }

  replyError(id: number, code: number, message: string): void {
    this.send({ jsonrpc: '2.0', id, error: { code, message } })
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('codex app-server not connected')
    }
    this.ws.send(JSON.stringify(payload))
  }

  private emit(notification: CodexNotification): void {
    for (const listener of this.listeners) {
      listener(notification)
    }
  }

  onNotification(listener: (n: CodexNotification) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async interrupt(threadId: string): Promise<void> {
    await this.call('turn/interrupt', { threadId })
  }

  async stop(): Promise<void> {
    this.ws?.close()

    const proc = this.codexProcess
    this.codexProcess = null

    if (proc && !proc.killed) {
      proc.kill('SIGTERM')

      const exited = await Promise.race([
        new Promise<boolean>(resolve => proc.on('exit', () => resolve(true))),
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 2000)),
      ])

      if (!exited && !proc.killed) {
        proc.kill('SIGKILL')
      }
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.initialized
  }
}
