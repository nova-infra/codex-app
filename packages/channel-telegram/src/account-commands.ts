/**
 * Telegram adapter for codex-account CommandReply.
 * Converts channel-agnostic CommandReply → Telegram messages,
 * and registers OAuth state with callbackRegistry.
 */

import type { TelegramSender } from '@/sender'
import type { InlineKeyboard } from '@/types'
import type { CommandReply } from '@codex-app/codex-account'
import { callbackRegistry } from '@codex-app/codex-account'
import type { ChannelCallbackContext } from '@codex-app/codex-account'

function buildKeyboard(buttons: CommandReply['buttons']): InlineKeyboard | undefined {
  if (!buttons?.length) return undefined
  return {
    inline_keyboard: buttons.map(row =>
      row.map(btn =>
        btn.url
          ? { text: btn.label, url: btn.url }
          : { text: btn.label, callback_data: btn.action },
      ),
    ),
  }
}

export async function sendCxReply(
  sender: TelegramSender,
  chatId: number,
  reply: CommandReply,
): Promise<void> {
  if (reply.pendingAction?.kind === 'oauth_login') {
    const ctx: ChannelCallbackContext = {
      channelType: 'telegram',
      chatId: String(chatId),
      state: reply.pendingAction.state,
      createdAt: Date.now(),
    }
    callbackRegistry.register(ctx)
  }

  const keyboard = buildKeyboard(reply.buttons)
  if (keyboard) {
    await sender.sendMessage(chatId, reply.text, keyboard)
  } else {
    await sender.sendMessage(chatId, reply.text)
  }
}
