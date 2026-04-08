import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'

export type AppPaths = {
  readonly root: string
  readonly config: string         // root/config.json
  readonly sessions: string       // root/sessions.json
  readonly bindings: string       // root/bindings.json
  readonly wechatSessions: string // root/wechat-sessions/
  readonly logs: string           // root/logs/
}

export function resolvePaths(rootDir?: string): AppPaths {
  const root = rootDir ?? process.env['CODEX_APP_HOME'] ?? join(homedir(), '.codex-app')
  return Object.freeze({
    root,
    config: join(root, 'config.json'),
    sessions: join(root, 'sessions.json'),
    bindings: join(root, 'bindings.json'),
    wechatSessions: join(root, 'wechat-sessions'),
    logs: join(root, 'logs'),
  })
}

export async function ensureDirs(paths: AppPaths): Promise<void> {
  await mkdir(paths.root, { recursive: true })
  await mkdir(paths.wechatSessions, { recursive: true })
  await mkdir(paths.logs, { recursive: true })
}

export const appPaths: AppPaths = resolvePaths()
