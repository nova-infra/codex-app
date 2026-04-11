import type { WechatSender } from '@/sender'

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function collectImageUrls(value: unknown): string[] {
  if (typeof value === 'string') {
    const text = value.trim()
    return /^https?:\/\//.test(text) ? [text] : []
  }
  if (Array.isArray(value)) return value.flatMap(collectImageUrls)
  const rec = asRecord(value)
  if (!rec) return []
  return [
    ...collectImageUrls(rec.imageUrl),
    ...collectImageUrls(rec.image_url),
    ...collectImageUrls(rec.full_url),
    ...collectImageUrls(rec.url),
    ...collectImageUrls(rec.result),
    ...collectImageUrls(rec.output),
    ...collectImageUrls(rec.content),
    ...collectImageUrls(rec.item),
  ]
}

export async function relayWechatGeneratedImages(
  sender: WechatSender,
  chatId: string,
  contextToken: string,
  item: unknown,
): Promise<void> {
  const urls = [...new Set(collectImageUrls(item))]
  for (const url of urls.slice(0, 4)) {
    try {
      const res = await fetch(url)
      if (!res.ok) continue
      const buf = Buffer.from(await res.arrayBuffer())
      await sender.sendImage(chatId, contextToken, buf)
    } catch {
      // best-effort
    }
  }
}
