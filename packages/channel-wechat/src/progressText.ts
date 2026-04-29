import { formatCodexItemProgress } from '@codex-app/core'

export function formatWechatItemProgress(params: unknown, phase: 'started' | 'completed' = 'started'): string | null {
  return formatCodexItemProgress(params, 96, phase)
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

export function extractWechatErrorMessage(params: unknown): string {
  const rec = asRecord(params)
  const error = asRecord(rec?.error)
  if (typeof error?.message === 'string' && error.message.trim()) return error.message.trim()
  if (typeof rec?.message === 'string' && rec.message.trim()) return rec.message.trim()
  return '未返回可读错误信息'
}
