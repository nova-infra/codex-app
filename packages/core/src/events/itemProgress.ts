function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

export type CodexItemProgressPhase = 'started' | 'completed'

const ITEM_ICONS: Record<string, string> = {
  reasoning: '🧠',
  commandExecution: '⚙️',
  fileChange: '✏️',
  webSearch: '🔎',
  mcpToolCall: '🧰',
  dynamicToolCall: '🛠️',
  plan: '📌',
  imageView: '🖼️',
  imageGeneration: '🎨',
  memory: '🧠',
  memoryRead: '🧠',
  memoryWrite: '💾',
  hook: '🪝',
  hookCall: '🪝',
  terminalInteraction: '⌨️',
  commandOutput: '📟',
}

const TYPE_LABELS: Record<string, string> = {
  reasoning: '思考',
  commandExecution: '命令',
  fileChange: '文件',
  webSearch: '搜索',
  mcpToolCall: '工具',
  dynamicToolCall: '工具',
  plan: '计划',
  imageView: '图片',
  imageGeneration: '图片',
  memory: '记忆',
  memoryRead: '记忆',
  memoryWrite: '记忆',
  hook: 'Hook',
  hookCall: 'Hook',
  terminalInteraction: '终端',
  commandOutput: '输出',
}

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

function summarizeFileChange(item: Record<string, unknown>): string {
  const changes = Array.isArray(item.changes) ? item.changes : []
  const first = asRecord(changes[0])
  const file = first ? pickString(first, ['filePath', 'path', 'file', 'name']) : ''
  const label = file ? basename(file) : '文件'
  return changes.length > 1 ? `${label} +${changes.length - 1}` : label
}

function summarizeToolCall(item: Record<string, unknown>): string {
  const tool = pickString(item, ['tool', 'toolName', 'name', 'method'])
  const server = pickString(item, ['server', 'serverName', 'namespace'])
  if (tool && server) return `${server}.${tool}`
  return tool || server || '调用工具'
}

function inferItemType(item: Record<string, unknown>): string {
  const explicit = pickString(item, ['type', 'kind'])
  const name = pickString(item, ['name', 'tool', 'toolName', 'method']).toLowerCase()
  if (/memory|remember|recall/.test(name)) return explicit || 'memory'
  if (/hook/.test(name)) return explicit || 'hook'
  return explicit
}

function extractItem(params: unknown): Record<string, unknown> | null {
  return asRecord(asRecord(params)?.item)
}

function progressLabel(type: string): string {
  if (/memory/i.test(type)) return '记忆'
  if (/hook/i.test(type)) return 'Hook'
  return TYPE_LABELS[type] ?? type
}

function progressIcon(type: string): string {
  return ITEM_ICONS[type] ?? (/memory/i.test(type) ? '🧠' : /hook/i.test(type) ? '🪝' : '')
}

function summarizeItem(type: string, item: Record<string, unknown>): string {
  switch (type) {
    case 'reasoning':
      return '正在分析'
    case 'commandExecution':
      return pickString(item, ['command', 'cmd']) || '执行命令'
    case 'fileChange':
      return summarizeFileChange(item)
    case 'webSearch':
      return pickString(item, ['query', 'searchQuery']) || '搜索网页'
    case 'mcpToolCall':
    case 'dynamicToolCall':
      return summarizeToolCall(item)
    case 'memory':
    case 'memoryRead':
    case 'memoryWrite':
      return pickString(item, ['key', 'query', 'name', 'content']) || summarizeToolCall(item) || 'Memory'
    case 'hook':
    case 'hookCall':
      return summarizeToolCall(item) || 'Hook'
    case 'plan':
      return '制定计划'
    case 'imageView':
      return '查看图片'
    case 'imageGeneration':
      return '生成图片'
    case 'terminalInteraction':
      return '等待终端输入'
    case 'commandOutput':
      return pickString(item, ['delta', 'text', 'output']) || '命令输出'
    default:
      return summarizeToolCall(item) || type
  }
}

export function formatCodexItemProgress(
  paramsOrItem: unknown,
  maxLen = 96,
  phase: CodexItemProgressPhase = 'started',
): string | null {
  const item = extractItem(paramsOrItem) ?? asRecord(paramsOrItem)
  if (!item) return null
  const type = inferItemType(item)
  if (!type || type === 'userMessage' || type === 'agentMessage') return null
  const icon = phase === 'completed' ? '✅' : progressIcon(type)
  if (!icon) return null

  const label = progressLabel(type)
  const detail = ellipsize(summarizeItem(type, item), maxLen)
  if (phase === 'completed') return `${icon} ${label}完成：${detail}`
  return `${icon} ${label}：${detail}`
}
