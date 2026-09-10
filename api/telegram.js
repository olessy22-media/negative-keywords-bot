/**
 * Единственная точка входа: вебхук Telegram.
 *
 * Эндпоинт публичный, поэтому доступ проверяется дважды — секретным заголовком
 * (запрос вообще от Telegram?) и белым списком chat_id (этому человеку можно?).
 */

import { createHash, timingSafeEqual } from 'node:crypto';

import { loadConfig } from '../src/config.js';
import { safeErrorText } from '../src/errors.js';
import { markUpdateSeen } from '../src/profiles/store.js';
import { escapeHtml } from '../src/report/format.js';
import { extractChatId, routeUpdate } from '../src/telegram/router.js';
import { sendMessage } from '../src/telegram/api.js';

const MAX_BODY_BYTES = 1024 * 1024;

/** Сравнение через хеши: длины совпадают, время сравнения не зависит от данных. */
function secretMatches(provided, expected) {
  const providedHash = createHash('sha256').update(String(provided ?? '')).digest();
  const expectedHash = createHash('sha256').update(String(expected)).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

async function readJsonBody(request) {
  if (request.body && typeof request.body === 'object') return request.body;

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Тело запроса слишком большое');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.status(405).json({ ok: false });
    return;
  }

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    // Ошибка конфигурации должна быть громкой: это поломка деплоя, а не запроса.
    console.error('Конфигурация:', error.message);
    response.status(500).json({ ok: false });
    return;
  }

  // Запрос без верного секрета пришёл не от Telegram, ретраев здесь можно
  // не опасаться — отвечаем честным отказом.
  if (!secretMatches(request.headers['x-telegram-bot-api-secret-token'], config.telegram.webhookSecret)) {
    console.warn('Отклонён запрос без верного секретного токена вебхука');
    response.status(401).json({ ok: false });
    return;
  }

  // Дальше отвечаем 200 в любом случае: иначе Telegram будет повторять update.
  let update;
  try {
    update = await readJsonBody(request);
  } catch (error) {
    console.error('Тело запроса:', error.name);
    response.status(200).json({ ok: true });
    return;
  }

  const chatId = extractChatId(update);

  try {
    if (!chatId) {
      response.status(200).json({ ok: true });
      return;
    }

    if (!config.telegram.allowedChatIds.includes(chatId)) {
      console.warn('Отклонён chat_id вне белого списка');
      await sendMessage(
        config.telegram.botToken,
        chatId,
        'Этот бот приватный и работает только для владельца.',
      );
      response.status(200).json({ ok: true });
      return;
    }

    // update_id приходит из тела запроса и попадает в ключ Redis: берём только
    // целое число, а не произвольную строку.
    const updateId = Number(update.update_id);
    if (Number.isSafeInteger(updateId)) {
      const isNew = await markUpdateSeen(config, updateId);
      if (!isNew) {
        response.status(200).json({ ok: true });
        return;
      }
    }

    await routeUpdate(config, update);
  } catch (error) {
    // Сообщения библиотек могут содержать фрагменты разбираемого файла, то есть
    // данные клиента. В лог и в чат уходит только текст, написанный нами.
    const text = safeErrorText(error);
    console.error('Обработка update:', text);
    await sendMessage(
      config.telegram.botToken,
      chatId,
      `Не получилось: ${escapeHtml(text)}`,
    ).catch((sendError) =>
      console.error('Не удалось отправить сообщение об ошибке:', sendError.name),
    );
  }

  response.status(200).json({ ok: true });
}
