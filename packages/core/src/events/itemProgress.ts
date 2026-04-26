function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

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
  const label = file ? `编辑 ${basename(file)}` : '编辑文件'
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

export function formatCodexItemProgress(paramsOrItem: unknown, maxLen = 96): string | null {
  const item = extractItem(paramsOrItem) ?? asRecord(paramsOrItem)
  if (!item) return null
  const type = inferItemType(item)
  if (!type || type === 'userMessage' || type === 'agentMessage') return null
  const icon = ITEM_ICONS[type] ?? (/memory/i.test(type) ? '🧠' : /hook/i.test(type) ? '🪝' : '')
  if (!icon) return null

  let detail = ''
  switch (type) {
    case 'reasoning':
      detail = 'Thinking'
      break
    case 'commandExecution':
      detail = pickString(item, ['command', 'cmd']) || '执行命令'
      break
    case 'fileChange':
      detail = summarizeFileChange(item)
      break
    case 'webSearch':
      detail = pickString(item, ['query', 'searchQuery']) || '搜索网页'
      break
    case 'mcpToolCall':
    case 'dynamicToolCall':
      detail = summarizeToolCall(item)
      break
    case 'memory':
    case 'memoryRead':
    case 'memoryWrite':
      detail = pickString(item, ['key', 'query', 'name', 'content']) || summarizeToolCall(item) || 'Memory'
      break
    case 'hook':
    case 'hookCall':
      detail = summarizeToolCall(item) || 'Hook'
      break
    case 'plan':
      detail = '制定计划'
      break
    case 'imageView':
      detail = '查看图片'
      break
    case 'imageGeneration':
      detail = '生成图片'
      break
    case 'terminalInteraction':
      detail = '等待终端输入'
      break
    case 'commandOutput':
      detail = pickString(item, ['delta', 'text', 'output']) || '命令输出'
      break
    default:
      detail = summarizeToolCall(item) || type
  }

  return `${icon} ${ellipsize(detail, maxLen)}`
}
