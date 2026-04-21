export type AutoCompactMode = 'manual' | 'suggest' | 'automatic'

export type SessionPolicyConfig = {
  readonly autoCompact: {
    readonly enabled: boolean
    readonly mode: AutoCompactMode
    readonly thresholdRatio: number
  }
}

export type SessionPolicyDecision =
  | { readonly kind: 'none' }
  | { readonly kind: 'suggest_compact'; readonly ratio: number }
  | { readonly kind: 'auto_compact'; readonly ratio: number }

const DEFAULT_POLICY: SessionPolicyConfig = {
  autoCompact: {
    enabled: true,
    mode: 'suggest',
    thresholdRatio: 0.8,
  },
}

export class SessionPolicyEngine {
  constructor(private readonly config: SessionPolicyConfig = DEFAULT_POLICY) {}

  get snapshot(): SessionPolicyConfig {
    return this.config
  }

  evaluateTokenUsage(used: number, total: number): SessionPolicyDecision {
    if (!this.config.autoCompact.enabled) return { kind: 'none' }
    if (!total || total <= 0 || used <= 0) return { kind: 'none' }

    const ratio = used / total
    if (ratio < this.config.autoCompact.thresholdRatio) return { kind: 'none' }

    if (this.config.autoCompact.mode === 'automatic') {
      return { kind: 'auto_compact', ratio }
    }

    return { kind: 'suggest_compact', ratio }
  }
}
