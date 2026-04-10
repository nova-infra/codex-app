export type ClientBootConfig = {
  readonly appName: 'rn-client'
  readonly transport: 'websocket'
  readonly serverUrl: string
  readonly reconnectIntervalMs: number
}

const DEFAULT_SERVER_URL = 'ws://127.0.0.1:4000/ws'
const DEFAULT_RECONNECT_INTERVAL_MS = 1_000

export function createClientBootConfig(
  overrides: Partial<Omit<ClientBootConfig, 'appName' | 'transport'>> = {},
): ClientBootConfig {
  return {
    appName: 'rn-client',
    transport: 'websocket',
    serverUrl:
      overrides.serverUrl ??
      process.env.EXPO_PUBLIC_CODEX_SERVER_URL ??
      DEFAULT_SERVER_URL,
    reconnectIntervalMs:
      overrides.reconnectIntervalMs ?? DEFAULT_RECONNECT_INTERVAL_MS,
  }
}
