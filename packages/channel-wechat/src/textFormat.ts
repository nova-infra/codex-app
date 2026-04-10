/**
 * WeChat text formatting: Markdown→纯文本、文本分块、引用提取。
 * Adapted from wechat-acp inbound/outbound patterns.
 */

import type { ILinkMessageItem } from '@/iLinkClient'
import { normalizeCdnMedia } from '@/cdnCrypto'

const DEFAULT_CHUNK = 4000
const CODE_INDENT = '    '
const SUMMARY_LIMIT = 120

// ── Format ──────────────────────────────────────────────────────────────────

/** Strip/convert markdown so WeChat reads cleaner (wechat-acp bridge). */
export function formatAssistantTextForWeChat(text: string): string {
  // 1. Fenced code blocks → 4-space indented (preserves structure)
  let out = text.replace(/```[^\n]*\n([\s\S]*?)```/g, (_match, code: string) => {
    return code.trimEnd().split('\n').map(line => CODE_INDENT + line).join('\n')
  })

  // 2. Images: ![alt](url) → [alt]
  out = out.replace(/!\[([^\]]*)\]\([^)]+\)/g, '[$1]')

  // 3. Links: [text](url) → text (url)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')

  // 4. Bold/italic (order: triple before double before single)
  out = out.replace(/\*\*\*(.+?)\*\*\*/g, '$1')
  out = out.replace(/\*\*(.+?)\*\*/g, '$1')
  out = out.replace(/\*(.+?)\*/g, '$1')
  out = out.replace(/__(.+?)__/g, '$1')
  out = out.replace(/_(.+?)_/g, '$1')

  // 5. Headers → 【title】
  out = out.replace(/^#{1,6}\s+(.+)$/gm, '【$1】')

  // 6. Collapse 3+ newlines
  out = out.replace(/\n{3,}/g, '\n\n')

  return out.trim()
}

export function buildWeChatSummaryFromFormatted(text: string, maxLen = SUMMARY_LIMIT): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
  const picked = paragraphs.find((part) => !part.startsWith(CODE_INDENT)) ?? paragraphs[0] ?? ''
  const singleLine = picked.replace(/\n+/g, ' ').trim()
  if (!singleLine) return ''
  return singleLine.length > maxLen
    ? `${singleLine.slice(0, maxLen - 1).trim()}…`
    : singleLine
}

// ── Split ────────────────────────────────────────────────────────────────────

/**
 * Split for iLink text limits.
 * Code-block aware: tries not to cut inside a 4-space indented block.
 * If the block itself exceeds maxLen, allows cutting at a newline within it.
 */
export function splitWeChatTextSegments(text: string, maxLen = DEFAULT_CHUNK): string[] {
  if (text.length <= maxLen) return [text]

  const segments: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      segments.push(remaining)
      break
    }

    const breakAt = findBreakPoint(remaining, maxLen)
    segments.push(remaining.substring(0, breakAt))
    remaining = remaining.substring(breakAt).replace(/^\n/, '')
  }

  return segments
}

/**
 * Find the best cut position ≤ maxLen.
 * Prefers a \n boundary outside a code block.
 */
function findBreakPoint(text: string, maxLen: number): number {
  const candidate = text.lastIndexOf('\n', maxLen)
  if (candidate <= 0) return maxLen

  // Determine if the candidate cut falls inside a code block
  const beforeLines = text.substring(0, candidate).split('\n')
  const lineAtCut = beforeLines[beforeLines.length - 1] ?? ''

  const afterStart = candidate + 1
  const afterNl = text.indexOf('\n', afterStart)
  const lineAfterCut = afterNl >= 0
    ? text.substring(afterStart, afterNl)
    : text.substring(afterStart)

  const inCodeBlock = lineAtCut.startsWith(CODE_INDENT) || lineAfterCut.startsWith(CODE_INDENT)
  if (!inCodeBlock) return candidate

  // Try to find the end of this code block (first line not starting with 4 spaces)
  const blockEnd = findCodeBlockEnd(text, candidate)

  if (blockEnd > 0 && blockEnd - candidate <= maxLen) {
    // Block end is reachable — cut just after it
    return blockEnd
  }

  // Block itself is too long; fall back to cutting within it at any \n
  return candidate
}

/** Scan forward from `pos` to find the next line that is not code-indented. */
function findCodeBlockEnd(text: string, pos: number): number {
  let i = pos
  // Advance past the current line
  const nextNl = text.indexOf('\n', i + 1)
  if (nextNl < 0) return text.length
  i = nextNl

  while (i < text.length) {
    const lineStart = i + 1
    if (lineStart >= text.length) return text.length
    const lineEnd = text.indexOf('\n', lineStart)
    const line = lineEnd >= 0 ? text.substring(lineStart, lineEnd) : text.substring(lineStart)
    if (!line.startsWith(CODE_INDENT) && line.trim() !== '') {
      // Found the first non-code, non-blank line — cut just before it
      return i
    }
    if (lineEnd < 0) return text.length
    i = lineEnd
  }

  return text.length
}

// ── Inbound ──────────────────────────────────────────────────────────────────

/** Merge all text + voice + video markers into one user prompt (multi-part messages). */
export function collectInboundTextForCodex(itemList?: ILinkMessageItem[]): string {
  if (!itemList?.length) return ''
  const parts: string[] = []
  for (const item of itemList) {
    if (item.type === 1 && item.text_item?.text != null) {
      const raw = String(item.text_item.text).trim()
      if (!raw) continue
      const ref = item.ref_msg
      if (!ref) {
        parts.push(raw)
        continue
      }
      const rp: string[] = []
      if (ref.title) rp.push(String(ref.title))
      const refText = ref.message_item?.text_item?.text
      if (refText) rp.push(String(refText))
      parts.push(rp.length ? `[引用: ${rp.join(' | ')}]\n${raw}` : raw)
    }
  }
  for (const item of itemList) {
    if (item.type !== 3 || !item.voice_item) continue
    const stt = typeof item.voice_item.text === 'string' ? item.voice_item.text.trim() : ''
    parts.push(stt || '[语音] 暂无文字转写。请改用文字发送或等待微信显示转写后再发。')
  }
  for (const item of itemList) {
    if (item.type === 5) parts.push('[视频]')
  }
  return parts.filter((p) => p.length > 0).join('\n')
}

/** Returns true when items contain rich media (image/file/video) with CDN refs. */
export function hasWeChatRichMediaForCommands(itemList?: ILinkMessageItem[]): boolean {
  if (!itemList?.length) return false
  return itemList.some((i) => {
    if (i.type === 5) return true
    if (i.type === 2) {
      const n = normalizeCdnMedia(i.image_item?.media)
      return !!(n?.encrypt_query_param || n?.full_url)
    }
    if (i.type === 4) {
      const n = normalizeCdnMedia(i.file_item?.media)
      return !!(n?.encrypt_query_param || n?.full_url)
    }
    return false
  })
}
