/**
 * WeChat text formatting: Markdown→纯文本、文本分块、引用提取。
 * Adapted from wechat-acp inbound/outbound patterns.
 */

import type { ILinkMessageItem } from '@/iLinkClient'
import { normalizeCdnMedia } from '@/cdnCrypto'

const DEFAULT_CHUNK = 4000

/** Strip common markdown so WeChat reads cleaner (wechat-acp bridge). */
export function formatAssistantTextForWeChat(text: string): string {
  let out = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '[$1]')
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
  out = out.replace(/\*\*\*(.+?)\*\*\*/g, '$1')
  out = out.replace(/\*\*(.+?)\*\*/g, '$1')
  out = out.replace(/\*(.+?)\*/g, '$1')
  out = out.replace(/__(.+?)__/g, '$1')
  out = out.replace(/_(.+?)_/g, '$1')
  out = out.replace(/^#{1,6}\s+/gm, '')
  out = out.replace(/\n{3,}/g, '\n\n')
  return out.trim()
}

/** Split for iLink text limits, preferring newlines (wechat-acp send.splitText). */
export function splitWeChatTextSegments(text: string, maxLen = DEFAULT_CHUNK): string[] {
  if (text.length <= maxLen) return [text]
  const segments: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      segments.push(remaining)
      break
    }
    let breakAt = remaining.lastIndexOf('\n', maxLen)
    if (breakAt <= 0) breakAt = maxLen
    segments.push(remaining.substring(0, breakAt))
    remaining = remaining.substring(breakAt).replace(/^\n/, '')
  }
  return segments
}

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
