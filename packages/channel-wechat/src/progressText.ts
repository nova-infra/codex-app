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
  const item = itemFrom(params)
  if (!item) return null
  const type = inferType(item)
  if (!type || type === 'userMessage' || type === 'agentMessage' || type === 'reasoning') return null
  const prefix = linePrefix(phase)
  const done = phase === 'completed' ? ' 完成' : ''

  switch (type) {
    case 'commandExecution':
      return `${prefix} Shell${done} ${ellipsize(pickString(item, ['command', 'cmd']) || '执行命令', 88)}`
    case 'webSearch':
      return `${prefix} Search${done} ${ellipsize(pickString(item, ['query', 'searchQuery']) || '搜索网页', 88)}`
    case 'mcpToolCall':
    case 'dynamicToolCall':
      return `${prefix} Tool${done} ${ellipsize(toolName(item), 88)}`
    case 'fileChange':
      return `${prefix} Edit${done} ${ellipsize(fileChangeName(item), 88)}`
    case 'imageGeneration':
      return `${prefix} Image${done} 生成图片`
    case 'imageView':
      return `${prefix} Image${done} 查看图片`
    case 'plan':
      return `${prefix} Plan${done} 制定计划`
    case 'terminalInteraction':
      return `${prefix} Terminal${done} 等待终端输入`
    case 'commandOutput':
      return `${prefix} Output${done} ${ellipsize(pickString(item, ['delta', 'text', 'output']) || '命令输出', 88)}`
    case 'memory':
    case 'memoryRead':
    case 'memoryWrite':
      return `${prefix} Memory${done} ${ellipsize(pickString(item, ['key', 'query', 'name', 'content']) || toolName(item), 88)}`
    case 'hook':
    case 'hookCall':
      return `${prefix} Hook${done} ${ellipsize(toolName(item), 88)}`
    default:
      return `${prefix} ${type}${done} ${ellipsize(toolName(item), 88)}`
  }
}

export function extractWechatErrorMessage(params: unknown): string {
  const rec = asRecord(params)
  const error = asRecord(rec?.error)
  if (typeof error?.message === 'string' && error.message.trim()) return error.message.trim()
  if (typeof rec?.message === 'string' && rec.message.trim()) return rec.message.trim()
  return '未返回可读错误信息'
}
