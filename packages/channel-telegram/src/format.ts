/**
 * Convert Markdown to Telegram-safe HTML.
 * Handles: bold, italic, code, pre, links. Escapes angle brackets in non-tag positions.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function markdownToTelegramHtml(md: string): string {
  let result = ''
  const lines = md.split('\n')
  let inCodeBlock = false
  let codeLang = ''
  let codeLines: string[] = []

  for (const line of lines) {
    // Code block toggle
    const fenceMatch = line.match(/^```(\w*)/)
    if (fenceMatch) {
      if (!inCodeBlock) {
        inCodeBlock = true
        codeLang = fenceMatch[1] ?? ''
        codeLines = []
      } else {
        // Close code block
        const langAttr = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : ''
        result += `<pre><code${langAttr}>${escapeHtml(codeLines.join('\n'))}</code></pre>\n`
        inCodeBlock = false
        codeLang = ''
        codeLines = []
      }
      continue
    }

    if (inCodeBlock) {
      codeLines.push(line)
      continue
    }

    result += formatInline(line) + '\n'
  }

  // Unclosed code block: dump as pre
  if (inCodeBlock && codeLines.length > 0) {
    result += `<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>\n`
  }

  return result.trimEnd()
}

function formatInline(line: string): string {
  // Escape HTML first
  let s = escapeHtml(line)

  // Headers → bold
  s = s.replace(/^#{1,6}\s+(.+)$/, '<b>$1</b>')

  // Inline code (must come before bold/italic to avoid conflicts)
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Bold: **text** or __text__
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  s = s.replace(/__(.+?)__/g, '<b>$1</b>')

  // Italic: *text* or _text_ (but not inside words with underscores)
  s = s.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '<i>$1</i>')
  s = s.replace(/(?<!\w)_([^_]+)_(?!\w)/g, '<i>$1</i>')

  // Links: [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  return s
}
