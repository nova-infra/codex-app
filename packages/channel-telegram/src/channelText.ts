const TELEGRAM_CHANNEL_PREAMBLE = [
  '你正在通过 Telegram 与用户对话。严格遵守以下输出约束：',
  '1. 先给结论、结果或下一步，再给补充说明。',
  '2. 默认使用简体中文，短段落，短句，高信息密度。',
  '3. 默认最多 3 个要点；不要写嵌套列表、表格或长 checklist。',
  '4. 内容过长时先给摘要版，细节等用户追问再展开。',
  '5. 代码、命令、路径只保留最短必要片段。',
  '6. 输出必须适合 Telegram；纯文本也必须可读。',
].join('\n')

export function buildTelegramTurnText(userText: string): string {
  const text = userText.trim()
  return text
    ? `${TELEGRAM_CHANNEL_PREAMBLE}\n\n用户消息：\n${text}`
    : TELEGRAM_CHANNEL_PREAMBLE
}
