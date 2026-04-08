/**
 * Build Codex `turn/start` `input[]` from WeChat iLink items.
 * Adapted from wechat-acp inbound + gateway image shape.
 */

import type { ILinkMessageItem } from '@/iLinkClient'
import { downloadWeChatCdnDecrypted, normalizeCdnMedia, parseAesKeyFromMedia } from '@/cdnCrypto'
import { collectInboundTextForCodex } from '@/textFormat'

function isTextLikeFileName(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return [
    'txt', 'md', 'json', 'js', 'ts', 'py', 'java', 'c', 'cpp', 'h',
    'css', 'html', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'sh',
    'bash', 'rs', 'go', 'rb', 'php', 'sql', 'csv', 'log', 'env',
  ].includes(ext)
}

function resolveAesKey(
  media: ReturnType<typeof normalizeCdnMedia>,
  item: ILinkMessageItem,
): Buffer | null {
  if (media) {
    const k = parseAesKeyFromMedia(media)
    if (k) return k
  }
  if (item.type === 2 && item.image_item?.aeskey) {
    const h = item.image_item.aeskey.trim()
    if (/^[0-9a-fA-F]{32}$/.test(h)) return Buffer.from(h, 'hex')
  }
  return null
}

async function processImageItem(item: ILinkMessageItem, cdnBaseUrl: string): Promise<{ url?: string; note?: string }> {
  const media = normalizeCdnMedia(item.image_item?.media)
  if (!media?.encrypt_query_param && !media?.full_url) return {}
  const key = resolveAesKey(media, item)
  if (!key) return { note: '[图片] 缺少解密密钥' }
  try {
    const buf = await downloadWeChatCdnDecrypted(key, cdnBaseUrl, media)
    return { url: `data:image/jpeg;base64,${buf.toString('base64')}` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const short = msg.length > 220 ? `${msg.slice(0, 220)}…` : msg
    return { note: `[图片] ${short}` }
  }
}

async function processFileItem(item: ILinkMessageItem, cdnBaseUrl: string): Promise<string | null> {
  const media = normalizeCdnMedia(item.file_item?.media)
  if (!media?.encrypt_query_param && !media?.full_url) return null
  const key = resolveAesKey(media, item)
  const fileName = item.file_item?.file_name ?? 'file'
  if (!key) return `[文件] ${fileName}（缺密钥）`
  try {
    const buf = await downloadWeChatCdnDecrypted(key, cdnBaseUrl, media)
    if (isTextLikeFileName(fileName)) return `--- ${fileName} ---\n${buf.toString('utf-8')}`
    return `[文件] ${fileName}（${buf.length} 字节，二进制已省略）`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const short = msg.length > 220 ? `${msg.slice(0, 220)}…` : msg
    return `[文件] ${fileName}: ${short}`
  }
}

export async function buildCodexTurnInputFromWeChatItems(
  items: ILinkMessageItem[],
  cdnBaseUrl: string,
): Promise<Array<Record<string, unknown>>> {
  const baseText = collectInboundTextForCodex(items)
  const notes: string[] = []
  const imageUrls: string[] = []

  for (const item of items) {
    if (item.type === 2) {
      const result = await processImageItem(item, cdnBaseUrl)
      if (result.url) imageUrls.push(result.url)
      if (result.note) notes.push(result.note)
    }
    if (item.type === 4) {
      const note = await processFileItem(item, cdnBaseUrl)
      if (note) notes.push(note)
    }
  }

  const mergedLines = [baseText, ...notes].filter((s) => s.trim().length > 0)
  const finalText = mergedLines.join('\n').trim()
  if (!finalText && imageUrls.length === 0) return []

  const resolvedText = finalText || (imageUrls.length ? '[图片]' : '')
  const input: Array<Record<string, unknown>> = [{ type: 'text', text: resolvedText }]
  for (const url of imageUrls) {
    input.push({ type: 'image', url, image_url: url })
  }
  return input
}
