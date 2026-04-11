function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function extractTextFromContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    const rec = asRecord(block)
    if (rec?.type === 'text' && typeof rec.text === 'string' && rec.text.trim()) parts.push(rec.text.trim())
  }
  return parts.join('\n')
}

export function extractLatestAssistant(payload: unknown): { text: string; signature: string } {
  const response = asRecord(payload)
  const thread = asRecord(response?.thread)
  const turns = Array.isArray(thread?.turns) ? thread.turns : []
  for (let ti = turns.length - 1; ti >= 0; ti -= 1) {
    const turn = asRecord(turns[ti])
    const turnId = typeof turn?.id === 'string' ? turn.id.trim() : ''
    const items = Array.isArray(turn?.items) ? turn.items : []
    for (let ii = items.length - 1; ii >= 0; ii -= 1) {
      const item = asRecord(items[ii])
      if (item?.type !== 'agentMessage') continue
      const itemId = typeof item.id === 'string' ? item.id.trim() : ''
      const text = (typeof item.text === 'string' ? item.text.trim() : '') || extractTextFromContent(item.content)
      if (!text) continue
      const signature = turnId && itemId ? `${turnId}:${itemId}` : `pos:${ti}:${ii}:${text.length}`
      return { text, signature }
    }
  }
  return { text: '', signature: '' }
}
