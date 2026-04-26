import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { WechatSender } from '@/sender'

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

type ImageCandidate =
  | { kind: 'url'; value: string }
  | { kind: 'path'; value: string }
  | { kind: 'data'; value: string }
  | { kind: 'base64'; value: string }

const IMAGE_KEYS = new Set([
  'imageUrl', 'image_url', 'full_url', 'url', 'result', 'output', 'content', 'path', 'localPath', 'local_path', 'file', 'filename',
])
const NESTED_KEYS = new Set(['item', 'image', 'images', 'media', 'data'])

function looksLikeImagePath(text: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(text) && (text.startsWith('/') || text.startsWith('file://'))
}

function looksLikeBase64Image(text: string): boolean {
  // Built-in image generation returns raw base64 in item.result.  Avoid trying
  // arbitrary short text as image data; a 1x1 PNG is already > 90 chars.
  if (text.length < 80 || !/^[A-Za-z0-9+/=\s]+$/.test(text)) return false
  const normalized = text.replace(/\s+/g, '')
  return normalized.startsWith('iVBORw0KGgo') || // PNG
    normalized.startsWith('/9j/') || // JPEG
    normalized.startsWith('UklGR') || // WEBP/RIFF
    normalized.startsWith('R0lGOD') // GIF
}

function collectImageCandidates(value: unknown, keyHint = ''): ImageCandidate[] {
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return []
    if (/^https?:\/\//.test(text)) return [{ kind: 'url', value: text }]
    if (/^data:image\//.test(text)) return [{ kind: 'data', value: text }]
    if (looksLikeImagePath(text)) return [{ kind: 'path', value: text.replace(/^file:\/\//, '') }]
    if ((keyHint === 'result' || keyHint === 'output' || keyHint === 'content' || keyHint === 'data') && looksLikeBase64Image(text)) {
      return [{ kind: 'base64', value: text }]
    }
    return []
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectImageCandidates(item, keyHint))
  const rec = asRecord(value)
  if (!rec) return []

  const out: ImageCandidate[] = []
  for (const [key, child] of Object.entries(rec)) {
    if (IMAGE_KEYS.has(key) || NESTED_KEYS.has(key)) {
      out.push(...collectImageCandidates(child, key))
    }
  }
  return out
}

function dedupeCandidates(candidates: ImageCandidate[]): ImageCandidate[] {
  const seen = new Set<string>()
  const out: ImageCandidate[] = []
  for (const candidate of candidates) {
    const sig = `${candidate.kind}:${candidate.value.slice(0, 512)}`
    if (seen.has(sig)) continue
    seen.add(sig)
    out.push(candidate)
  }
  return out
}

function bufferFromDataUrl(value: string): Buffer | null {
  const match = value.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/is)
  if (!match) return null
  return Buffer.from(match[1].replace(/\s+/g, ''), 'base64')
}

async function loadCandidate(candidate: ImageCandidate): Promise<Buffer | null> {
  if (candidate.kind === 'url') {
    const res = await fetch(candidate.value)
    if (!res.ok) throw new Error(`image fetch failed: HTTP ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }
  if (candidate.kind === 'path') {
    if (!existsSync(candidate.value)) throw new Error(`image path not found: ${candidate.value}`)
    return readFile(candidate.value)
  }
  if (candidate.kind === 'data') {
    return bufferFromDataUrl(candidate.value)
  }
  return Buffer.from(candidate.value.replace(/\s+/g, ''), 'base64')
}

export async function relayWechatGeneratedImages(
  sender: WechatSender,
  chatId: string,
  contextToken: string,
  item: unknown,
): Promise<void> {
  const candidates = dedupeCandidates(collectImageCandidates(item)).slice(0, 4)
  for (const candidate of candidates) {
    try {
      const buf = await loadCandidate(candidate)
      if (!buf || buf.length === 0) continue
      await sender.sendImage(chatId, contextToken, buf)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[wechat] image relay failed (${candidate.kind}): ${message}`)
    }
  }
}
