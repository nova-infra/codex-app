/**
 * Convert Markdown to Telegram-safe HTML.
 *
 * Pipeline (placeholder protection):
 *  1. Extract fenced code blocks  → \x00CB{n}\x00
 *  2. Extract inline code         → \x00IC{n}\x00
 *  3. Extract tables              → \x00TB{n}\x00
 *  4. Escape HTML in remaining text
 *  5. Convert markdown (headers, bold, italic, strike, links, blockquote, hr, lists)
 *  6. Restore placeholders
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// ---------------------------------------------------------------------------
// Table helpers
// ---------------------------------------------------------------------------

function isTableRow(line: string): boolean {
  return /^\|.+\|/.test(line.trim())
}

function isSeparatorRow(line: string): boolean {
  return /^\|[\s\-:|]+\|/.test(line.trim())
}

function formatTable(lines: string[]): string {
  // Filter out separator rows for rendering
  const dataLines = lines.filter(l => !isSeparatorRow(l))

  // Split each row into cells
  const rows = dataLines.map(l =>
    l
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map(c => c.trim()),
  )

  if (rows.length === 0) return lines.join('\n')

  // Compute column widths
  const colCount = Math.max(...rows.map(r => r.length))
  const widths: number[] = Array.from({ length: colCount }, (_, i) =>
    Math.max(...rows.map(r => (r[i] ?? '').length)),
  )

  const formatted = rows.map(cells => {
    const padded = Array.from({ length: colCount }, (_, i) =>
      (cells[i] ?? '').padEnd(widths[i]),
    )
    return '| ' + padded.join(' | ') + ' |'
  })

  return formatted.join('\n')
}

// ---------------------------------------------------------------------------
// Main converter
// ---------------------------------------------------------------------------

export function markdownToTelegramHtml(md: string): string {
  const codeBlocks: string[] = []
  const inlineCodes: string[] = []
  const tables: string[] = []

  // Step 1: Extract fenced code blocks
  let text = md.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang: string, body: string) => {
    const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : ''
    const html = `<pre><code${langAttr}>${escapeHtml(body.replace(/\n$/, ''))}</code></pre>`
    const idx = codeBlocks.push(html) - 1
    return `\x00CB${idx}\x00`
  })

  // Step 2: Extract inline code
  text = text.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    const html = `<code>${escapeHtml(code)}</code>`
    const idx = inlineCodes.push(html) - 1
    return `\x00IC${idx}\x00`
  })

  // Step 3: Extract tables (consecutive lines that look like table rows)
  text = text.replace(/((?:^\|.+\|\n?)+)/gm, (block: string) => {
    const lines = block.split('\n').filter(l => l.trim() !== '')
    if (lines.length < 2) return block
    const hasHeader = lines.some(isSeparatorRow)
    if (!hasHeader) return block
    const tableText = formatTable(lines)
    const html = `<pre>${escapeHtml(tableText)}</pre>`
    const idx = tables.push(html) - 1
    return `\x00TB${idx}\x00`
  })

  // Step 4: Escape HTML in remaining text
  // We need to escape only the non-placeholder portions
  text = text
    .split(/(\x00(?:CB|IC|TB)\d+\x00)/)
    .map(part => (/^\x00(?:CB|IC|TB)\d+\x00$/.test(part) ? part : escapeHtml(part)))
    .join('')

  // Step 5: Convert markdown syntax
  const lines = text.split('\n')
  const outputLines = lines.map(line => {
    // Skip lines that are entirely a placeholder
    if (/^\x00(?:CB|IC|TB)\d+\x00$/.test(line.trim())) return line

    let s = line

    // Headings → bold
    s = s.replace(/^#{1,6}\s+(.+)$/, '<b>$1</b>')

    // Blockquote
    s = s.replace(/^&gt;\s*(.*)$/, '<blockquote>$1</blockquote>')

    // Horizontal rule
    s = s.replace(/^---+$/, '———')

    // Unordered list
    s = s.replace(/^(\s*)[-*]\s+(.+)$/, '$1• $2')

    // Strikethrough ~~text~~
    s = s.replace(/~~(.+?)~~/g, '<s>$1</s>')

    // Bold: **text** or __text__
    s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    s = s.replace(/__(.+?)__/g, '<b>$1</b>')

    // Italic: *text* or _text_ (word-boundary aware)
    s = s.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, '<i>$1</i>')
    s = s.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '<i>$1</i>')

    // Links: [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

    return s
  })

  text = outputLines.join('\n')

  // Step 6: Restore placeholders
  text = text.replace(/\x00IC(\d+)\x00/g, (_m, i) => inlineCodes[Number(i)] ?? '')
  text = text.replace(/\x00TB(\d+)\x00/g, (_m, i) => tables[Number(i)] ?? '')
  text = text.replace(/\x00CB(\d+)\x00/g, (_m, i) => codeBlocks[Number(i)] ?? '')

  return text.trimEnd()
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
}

export function splitTelegramMarkdown(md: string, maxLen = 3200): readonly string[] {
  const trimmed = md.trim()
  if (!trimmed) return []
  if (trimmed.length <= maxLen) return [trimmed]

  const chunks: string[] = []
  let remaining = trimmed

  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf('\n\n', maxLen)
    if (splitAt > 0) {
      splitAt += 2
    } else {
      splitAt = remaining.lastIndexOf('\n', maxLen)
      if (splitAt > 0) {
        splitAt += 1
      } else {
        splitAt = maxLen
      }
    }
    chunks.push(remaining.slice(0, splitAt).trim())
    remaining = remaining.slice(splitAt).trim()
  }

  if (remaining) chunks.push(remaining)
  return chunks
}

export function renderTelegramHtmlSegments(md: string, maxMarkdownLen = 3200): readonly string[] {
  return splitTelegramMarkdown(md, maxMarkdownLen)
    .map(chunk => markdownToTelegramHtml(chunk))
    .filter(Boolean)
}

const MDV2_PLACEHOLDER_RE = /(\x00(?:CB|IC)\d+\x00)/g
const MDV2_ESCAPE_RE = /([_*\[\]()~`>#\+\-=|{}.!\\])/g

function escapeMarkdownV2(text: string): string {
  return text.replace(MDV2_ESCAPE_RE, '\\$1')
}

export function markdownToTelegramMarkdownV2(md: string): string {
  const codeBlocks: string[] = []
  const inlineCodes: string[] = []

  let text = md.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang: string, body: string) => {
    const fence = lang ? `\`\`\`${lang}\n${body.replace(/\n$/, '')}\n\`\`\`` : `\`\`\`\n${body.replace(/\n$/, '')}\n\`\`\``
    const idx = codeBlocks.push(fence) - 1
    return `\x00CB${idx}\x00`
  })

  text = text.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    const idx = inlineCodes.push(`\`${code}\``) - 1
    return `\x00IC${idx}\x00`
  })

  const isPlaceholder = (part: string): boolean => /^\x00(?:CB|IC)\d+\x00$/.test(part)

  text = text
    .split(MDV2_PLACEHOLDER_RE)
    .map(part => (isPlaceholder(part) ? part : escapeMarkdownV2(part)))
    .join('')

  text = text
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    .replace(/^(\s*)[-*]\s+(.+)$/gm, '$1• $2')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '*$1*')
    .replace(/~~(.+?)~~/g, '~$1~')

  text = text.replace(/\x00IC(\d+)\x00/g, (_m, i) => inlineCodes[Number(i)] ?? '')
  text = text.replace(/\x00CB(\d+)\x00/g, (_m, i) => codeBlocks[Number(i)] ?? '')

  return text.trim()
}

export function renderTelegramMarkdownSegments(md: string, maxMarkdownLen = 3200): readonly string[] {
  return splitTelegramMarkdown(md, maxMarkdownLen)
    .filter(Boolean)
}

export function telegramHtmlToPlainText(html: string): string {
  const text = html
    .replace(/<pre><code[^>]*>/g, '```\n')
    .replace(/<\/code><\/pre>/g, '\n```')
    .replace(/<blockquote>/g, '')
    .replace(/<\/blockquote>/g, '')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/p>/g, '\n')
    .replace(/<[^>]+>/g, '')
  return decodeHtmlEntities(text).replace(/\n{3,}/g, '\n\n').trim()
}

// ---------------------------------------------------------------------------
// Message splitter
// ---------------------------------------------------------------------------

/**
 * Split an HTML string into chunks of at most `maxLen` characters.
 * Prefers splitting at paragraph boundaries, then line boundaries, then hard cut.
 */
export function splitTelegramMessage(html: string, maxLen = 4096): readonly string[] {
  if (html.length <= maxLen) return [html]

  const chunks: string[] = []
  let remaining = html

  while (remaining.length > maxLen) {
    let splitAt = -1

    // Try paragraph boundary (\n\n) within maxLen
    const paraIdx = remaining.lastIndexOf('\n\n', maxLen)
    if (paraIdx > 0) {
      splitAt = paraIdx + 2
    } else {
      // Try line boundary (\n)
      const lineIdx = remaining.lastIndexOf('\n', maxLen)
      if (lineIdx > 0) {
        splitAt = lineIdx + 1
      } else {
        // Hard cut
        splitAt = maxLen
      }
    }

    chunks.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt)
  }

  if (remaining.length > 0) chunks.push(remaining)

  return chunks
}
