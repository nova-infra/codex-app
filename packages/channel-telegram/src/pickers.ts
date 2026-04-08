import { basename } from 'node:path'
import type { CodexClient } from '@codex-app/core'
import { REASONING_EFFORTS, MODEL_PICKER_LIMIT } from '@/types'
import type { TelegramSender } from '@/sender'

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

export type ThreadSummary = { id: string; title: string; workspace: string }

export async function listThreads(codex: CodexClient): Promise<ThreadSummary[]> {
  const res = asRecord(await codex.call('thread/list', { archived: false, limit: 20, sortKey: 'updated_at' }))
  const rows = Array.isArray(res?.data) ? res.data : []
  return rows.flatMap((row: unknown) => {
    const r = asRecord(row)
    const id = typeof r?.id === 'string' ? r.id.trim() : ''
    if (!id) return []
    const cwd = typeof r?.cwd === 'string' ? r.cwd.trim() : ''
    const name = typeof r?.name === 'string' ? r.name : typeof r?.preview === 'string' ? r.preview : id
    return [{ id, title: name.slice(0, 64), workspace: cwd ? basename(cwd) : 'project' }]
  })
}

export async function sendThreadPicker(chatId: number, codex: CodexClient, sender: TelegramSender): Promise<void> {
  const threads = await listThreads(codex)
  if (!threads.length) {
    await sender.sendMessage(chatId, '没有找到会话，发送 /new 创建。')
    return
  }
  const byWs = new Map<string, ThreadSummary[]>()
  for (const t of threads) {
    const list = byWs.get(t.workspace) ?? []
    byWs.set(t.workspace, [...list, t])
  }
  const rows = [...byWs.keys()].map(ws => [{ text: ws, callback_data: `ws:${ws}` }])
  await sender.sendMessage(chatId, '选择工作空间：', { inline_keyboard: rows })
}

export async function sendModelPicker(chatId: number, codex: CodexClient, sender: TelegramSender): Promise<void> {
  const res = asRecord(await codex.call('model/list', {}))
  const rows = Array.isArray(res?.data) ? res.data : []
  const models = [...new Set(rows.flatMap((r: unknown) => {
    const rec = asRecord(r)
    return typeof rec?.id === 'string' ? [rec.id] : typeof rec?.model === 'string' ? [rec.model] : []
  }))].slice(0, MODEL_PICKER_LIMIT)
  if (!models.length) { await sender.sendMessage(chatId, '没有可用模型。'); return }
  const keyboard = []
  for (let i = 0; i < models.length; i += 2) {
    const row = [{ text: models[i], callback_data: `model:${models[i]}` }]
    if (i + 1 < models.length) row.push({ text: models[i + 1], callback_data: `model:${models[i + 1]}` })
    keyboard.push(row)
  }
  await sender.sendMessage(chatId, '选择模型：', { inline_keyboard: keyboard })
}

export async function sendReasoningPicker(chatId: number, sender: TelegramSender): Promise<void> {
  const keyboard = []
  for (let i = 0; i < REASONING_EFFORTS.length; i += 2) {
    const row = [{ text: REASONING_EFFORTS[i], callback_data: `reasoning:${REASONING_EFFORTS[i]}` }]
    if (i + 1 < REASONING_EFFORTS.length) row.push({ text: REASONING_EFFORTS[i + 1], callback_data: `reasoning:${REASONING_EFFORTS[i + 1]}` })
    keyboard.push(row)
  }
  await sender.sendMessage(chatId, '选择推理深度：', { inline_keyboard: keyboard })
}

export function extractLatestAssistantText(payload: unknown): string {
  const res = asRecord(payload)
  const thread = asRecord(res?.thread)
  const turns = Array.isArray(thread?.turns) ? thread.turns : []
  for (let ti = turns.length - 1; ti >= 0; ti--) {
    const turn = asRecord(turns[ti])
    const items = Array.isArray(turn?.items) ? turn.items : []
    for (let ii = items.length - 1; ii >= 0; ii--) {
      const item = asRecord(items[ii])
      if (item?.type !== 'agentMessage') continue
      const direct = typeof item.text === 'string' ? item.text.trim() : ''
      if (direct) return direct
      const parts = (Array.isArray(item.content) ? item.content : []).flatMap((b: unknown) => {
        const block = asRecord(b)
        return block?.type === 'text' && typeof block.text === 'string' ? [block.text.trim()] : []
      })
      if (parts.length) return parts.join('\n')
    }
  }
  return ''
}
