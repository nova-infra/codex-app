function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

export function formatWechatItemProgress(params: unknown): string | null {
  const item = asRecord(asRecord(params)?.item)
  if (!item) return null
  const type = typeof item.type === 'string' ? item.type : ''
  switch (type) {
    case 'reasoning':
      return '处理中：思考中…'
    case 'commandExecution':
      return '处理中：执行命令…'
    case 'fileChange':
      return '处理中：修改文件…'
    case 'webSearch':
      return '处理中：搜索资料…'
    case 'mcpToolCall':
    case 'dynamicToolCall':
      return '处理中：调用工具…'
    case 'plan':
      return '处理中：整理方案…'
    default:
      return null
  }
}

export function extractWechatErrorMessage(params: unknown): string {
  const rec = asRecord(params)
  const error = asRecord(rec?.error)
  if (typeof error?.message === 'string' && error.message.trim()) return error.message.trim()
  if (typeof rec?.message === 'string' && rec.message.trim()) return rec.message.trim()
  return '未返回可读错误信息'
}
