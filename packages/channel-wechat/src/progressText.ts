import { formatCodexItemProgress } from '@codex-app/core'
function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

type ProgressPhase = 'started' | 'completed'

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function ellipsize(text: string, maxLen: number): string {
  const s = compactWhitespace(text)
  if (s.length <= maxLen) return s
  return `${s.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`
}

function basename(path: string): string {
  const clean = path.trim().replace(/\\/g, '/')
  return clean.split('/').filter(Boolean).pop() ?? clean
}

function pickString(rec: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const v = rec[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

function itemFrom(params: unknown): Record<string, unknown> | null {
  return asRecord(asRecord(params)?.item) ?? asRecord(params)
}

function inferType(item: Record<string, unknown>): string {
  const explicit = pickString(item, ['type', 'kind'])
  const name = pickString(item, ['name', 'tool', 'toolName', 'method']).toLowerCase()
  if (/memory|remember|recall/.test(name)) return explicit || 'memory'
  if (/hook/.test(name)) return explicit || 'hook'
  return explicit
}

function fileChangeName(item: Record<string, unknown>): string {
  const changes = Array.isArray(item.changes) ? item.changes : []
  const first = asRecord(changes[0])
  const file = first ? pickString(first, ['filePath', 'path', 'file', 'name']) : ''
  const label = file ? basename(file) : '文件'
  return changes.length > 1 ? `${label} +${changes.length - 1}` : label
}

function toolName(item: Record<string, unknown>): string {
  const tool = pickString(item, ['tool', 'toolName', 'name', 'method'])
  const server = pickString(item, ['server', 'serverName', 'namespace'])
  if (tool && server) return `${server}.${tool}`
  return tool || server || '调用工具'
}

function linePrefix(phase: ProgressPhase): string {
  return phase === 'completed' ? '✓' : '▸'
}

export function formatWechatItemProgress(params: unknown, phase: ProgressPhase = 'started'): string | null {
  return formatCodexItemProgress(params, 96, phase)
}

export function extractWechatErrorMessage(params: unknown): string {
  const rec = asRecord(params)
  const error = asRecord(rec?.error)
  if (typeof error?.message === 'string' && error.message.trim()) return error.message.trim()
  if (typeof rec?.message === 'string' && rec.message.trim()) return rec.message.trim()
  return '未返回可读错误信息'
}
