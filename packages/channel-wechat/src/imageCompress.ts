import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const WX_IMAGE_TARGET_BYTES = 900 * 1024
const WX_IMAGE_HARD_LIMIT_BYTES = 1200 * 1024

function hasJpegHeader(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
}

function hasPngHeader(buf: Buffer): boolean {
  return buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
}

function hasWebpHeader(buf: Buffer): boolean {
  return buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP'
}

function inputExt(buf: Buffer): string {
  if (hasJpegHeader(buf)) return '.jpg'
  if (hasPngHeader(buf)) return '.png'
  if (hasWebpHeader(buf)) return '.webp'
  return '.img'
}

async function convertWithMagick(input: string, output: string, quality: number, maxEdge: number): Promise<Buffer> {
  await execFileAsync('magick', [
    input,
    '-auto-orient',
    '-strip',
    '-resize', `${maxEdge}x${maxEdge}>`,
    '-background', 'white',
    '-alpha', 'remove',
    '-alpha', 'off',
    '-interlace', 'JPEG',
    '-quality', String(quality),
    output,
  ], { timeout: 30_000, maxBuffer: 1024 * 1024 })
  return readFile(output)
}

export async function prepareImageForWeChat(imageBuffer: Buffer): Promise<Buffer> {
  // Small JPEGs usually pass; avoid unnecessary recompression.
  if (imageBuffer.length <= WX_IMAGE_TARGET_BYTES && hasJpegHeader(imageBuffer)) return imageBuffer

  const dir = await mkdtemp(join(tmpdir(), 'codex-wx-image-'))
  try {
    const input = join(dir, `input${inputExt(imageBuffer)}`)
    await writeFile(input, imageBuffer)

    const attempts = [
      { quality: 82, maxEdge: 1280 },
      { quality: 76, maxEdge: 1024 },
      { quality: 68, maxEdge: 896 },
    ]

    let best: Buffer | null = null
    for (const attempt of attempts) {
      const output = join(dir, `out-q${attempt.quality}-${attempt.maxEdge}.jpg`)
      const converted = await convertWithMagick(input, output, attempt.quality, attempt.maxEdge)
      best = converted
      if (converted.length <= WX_IMAGE_TARGET_BYTES) return converted
    }

    if (best && best.length <= WX_IMAGE_HARD_LIMIT_BYTES) return best
    return best ?? imageBuffer
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[wechat] image compression skipped: ${message}`)
    return imageBuffer
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
