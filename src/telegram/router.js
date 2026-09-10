/**
 * Разбор входящего update и передача его нужному обработчику.
 * Роутер не знает, что делают обработчики, и не принимает решений о доступе —
 * доступ проверяется раньше, на границе вебхука.
 */

import { handleCallback, handleCommand, handleDialogAnswer } from './handlers/commands.js';
import { handleDocument } from './handlers/document.js';
import { sendMessage } from './api.js';

/** Достаёт chat_id из тех типов update, которые бот обрабатывает. */
export function extractChatId(update) {
  const chat =
    update?.message?.chat ?? update?.edited_message?.chat ?? update?.callback_query?.message?.chat;
  return chat?.id !== undefined ? String(chat.id) : '';
}

/**
 * @param {object} config
 * @param {object} update update от Telegram
 * @returns {Promise<void>}
 */
export async function routeUpdate(config, update) {
  const token = config.telegram.botToken;
  const chatId = extractChatId(update);
  if (!chatId) return;

  if (update.callback_query) {
    await handleCallback(config, chatId, token, update.callback_query);
    return;
  }

  const message = update.message;
  if (!message) return;

  if (message.document) {
    await handleDocument(config, chatId, message.document);
    return;
  }

  const text = String(message.text ?? '').trim();
  if (!text) return;

  if (text.startsWith('/')) {
    const handled = await handleCommand(config, chatId, token, text);
    if (!handled) {
      await sendMessage(token, chatId, 'Не знаю такой команды. Справка: /help');
    }
    return;
  }

  const answered = await handleDialogAnswer(config, chatId, token, text);
  if (!answered) {
    await sendMessage(
      token,
      chatId,
      'Пришлите CSV отчёта «Поисковые запросы» из Google Ads. Справка: /help',
    );
  }
}
