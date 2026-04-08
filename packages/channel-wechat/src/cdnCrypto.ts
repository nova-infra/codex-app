/**
 * WeChat CDN AES-128-ECB encrypt/decrypt.
 * Aligned with openclaw-weixin and wechat-acp media.ts.
 */

import { createCipheriv, createDecipheriv } from 'node:crypto'

export type WechatCdnMediaRef = {
  encrypt_query_param?: string
  aes_key?: string
}

export type NormalizedCdnMedia = WechatCdnMediaRef & {
  full_url?: string
}

export function normalizeCdnMedia(raw: unknown): NormalizedCdnMedia | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = o[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    return undefined
  }
  const encrypt_query_param = pick('encrypt_query_param', 'encryptQueryParam')
  const aes_key = pick('aes_key', 'aesKey')
  const full_url = pick('full_url', 'fullUrl')
  if (!encrypt_query_param && !full_url && !aes_key) return null
  return { encrypt_query_param, aes_key, full_url }
}

export function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null)
  return Buffer.concat([cipher.update(plaintext), cipher.final()])
}

export function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv('aes-128-ecb', key, null)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

export function parseAesKeyFromMedia(media: WechatCdnMediaRef): Buffer | null {
  const raw = media.aes_key
  if (!raw) return null
  const decoded = Buffer.from(raw, 'base64')
  if (decoded.length === 16) return decoded
  if (decoded.length === 32) {
    const hexStr = decoded.toString('ascii')
    if (/^[0-9a-fA-F]{32}$/.test(hexStr)) return Buffer.from(hexStr, 'hex')
  }
  return decoded.subarray(0, 16)
}

export function resolveWeChatCdnDownloadUrl(cdnBaseUrl: string, ref: NormalizedCdnMedia): string {
  const root = cdnBaseUrl.replace(/\/$/, '')
  const param = ref.encrypt_query_param?.trim()
  if (!param) throw new Error('CDN 缺少 encrypt_query_param')
  return `${root}/download?encrypted_query_param=${encodeURIComponent(param)}`
}

export async function downloadWeChatCdnDecrypted(
  aesKey: Buffer,
  cdnBaseUrl: string,
  mediaRef: NormalizedCdnMedia | null,
): Promise<Buffer> {
  if (!mediaRef) throw new Error('CDN media 无效')
  const url = resolveWeChatCdnDownloadUrl(cdnBaseUrl, mediaRef)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`CDN download failed: HTTP ${res.status}`)
  const ciphertext = Buffer.from(await res.arrayBuffer())
  return decryptAesEcb(ciphertext, aesKey)
}

export async function uploadWeChatCdnEncrypted(
  buffer: Buffer,
  uploadParam: string,
  aesKey: Buffer,
  filekey: string,
  cdnBaseUrl: string,
): Promise<string> {
  const encrypted = encryptAesEcb(buffer, aesKey)
  const root = cdnBaseUrl.replace(/\/$/, '')
  const url = `${root}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: encrypted as unknown as BodyInit,
  })
  if (!res.ok) throw new Error(`CDN upload failed: HTTP ${res.status}`)
  const downloadParam = res.headers.get('x-encrypted-param')
  if (!downloadParam) throw new Error('CDN upload: missing x-encrypted-param header')
  return downloadParam
}
