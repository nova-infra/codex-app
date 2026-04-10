import type { ChannelCallbackContext } from './command-types'

const STATE_TTL_MS = 10 * 60 * 1000  // 10 分钟过期

export type LoginCompleteHandler = (ctx: ChannelCallbackContext, email: string) => void

class CallbackRegistry {
  private readonly pending = new Map<string, ChannelCallbackContext>()
  private readonly loginHandlers = new Set<LoginCompleteHandler>()

  /** 存储 state → context 映射 */
  register(ctx: ChannelCallbackContext): void {
    this.pruneExpired()
    this.pending.set(ctx.state, ctx)
  }

  /** 一次性取出并删除；过期或不存在返回 null */
  resolve(state: string): ChannelCallbackContext | null {
    const ctx = this.pending.get(state) ?? null
    if (!ctx) return null

    this.pending.delete(state)

    if (Date.now() - ctx.createdAt > STATE_TTL_MS) return null

    return ctx
  }

  /** 注册 OAuth 成功后的通知 handler */
  onLogin(handler: LoginCompleteHandler): void {
    this.loginHandlers.add(handler)
  }

  /**
   * OAuth callback 成功后由 server 调用。
   * 内部取出 context，然后触发已注册的 handler 向 channel 推送消息。
   */
  notifyLogin(state: string, email: string): void {
    const ctx = this.resolve(state)
    if (!ctx || this.loginHandlers.size === 0) return
    for (const handler of this.loginHandlers) handler(ctx, email)
  }

  /** 清理超过 TTL 的条目 */
  pruneExpired(): void {
    const now = Date.now()
    for (const [key, ctx] of this.pending) {
      if (now - ctx.createdAt > STATE_TTL_MS) {
        this.pending.delete(key)
      }
    }
  }
}

export const callbackRegistry = new CallbackRegistry()
