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
}

const MAX_PROGRESS_LINE = 96

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function ellipsize(text: string, maxLen = MAX_PROGRESS_LINE): string {
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
  const tool = pickString(item, ['tool', 'toolName', 'name'])
  const server = pickString(item, ['server', 'serverName'])
  if (tool && server) return `${server}.${tool}`
  return tool || server || '调用工具'
}

export function formatWechatItemProgress(params: unknown): string | null {
  const item = asRecord(asRecord(params)?.item)
  if (!item) return null
  const type = typeof item.type === 'string' ? item.type : ''
  const icon = ITEM_ICONS[type]
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
    case 'plan':
      detail = '制定计划'
      break
    case 'imageView':
      detail = '查看图片'
      break
    case 'imageGeneration':
      detail = '生成图片'
      break
    default:
      detail = type
  }

  return `${icon} ${ellipsize(detail)}`
}

export function extractWechatErrorMessage(params: unknown): string {
  const rec = asRecord(params)
  const error = asRecord(rec?.error)
  if (typeof error?.message === 'string' && error.message.trim()) return error.message.trim()
  if (typeof rec?.message === 'string' && rec.message.trim()) return rec.message.trim()
  return '未返回可读错误信息'
}
