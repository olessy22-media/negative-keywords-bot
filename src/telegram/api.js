/**
 * Тонкая обёртка над Telegram Bot API поверх нативного fetch.
 * Библиотека-обёртка не нужна: используются четыре метода.
 *
 * Токен бота попадает в URL — так устроен Bot API. Поэтому URL здесь
 * не логируется никогда, ни в ошибках, ни в отладке.
 */

const API_BASE = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 30000;

class TelegramApiError extends Error {
  constructor(method, description) {
    super(`Telegram API ${method}: ${description}`);
    this.name = 'TelegramApiError';
    this.method = method;
  }
}

async function callApi(token, method, payload) {
  const response = await fetch(`${API_BASE}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new TelegramApiError(method, data.description ?? `HTTP ${response.status}`);
  }
  return data.result;
}

/**
 * @param {string} token токен бота
 * @param {number|string} chatId
 * @param {string} text текст сообщения (parse_mode=HTML, значения экранированы вызывающим)
 * @param {object} [extra] дополнительные поля Bot API, например reply_markup
 */
export function sendMessage(token, chatId, text, extra = {}) {
  return callApi(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...extra,
  });
}

/** Убирает «часики» на нажатой кнопке. */
export function answerCallbackQuery(token, callbackQueryId, text = '') {
  return callApi(token, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
  });
}

/** @returns {Promise<{file_path: string, file_size: number}>} */
export function getFile(token, fileId) {
  return callApi(token, 'getFile', { file_id: fileId });
}

/**
 * Скачивает файл пользователя.
 * @returns {Promise<Buffer>}
 * @throws {Error} если файл больше разрешённого размера
 */
export async function downloadFile(token, filePath, maxBytes) {
  const response = await fetch(`${API_BASE}/file/bot${token}/${filePath}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Не удалось скачать файл: HTTP ${response.status}`);
  }

  const declaredSize = Number(response.headers.get('content-length') ?? 0);
  if (declaredSize > maxBytes) {
    throw new Error(`Файл больше ${Math.round(maxBytes / 1024 / 1024)} МБ.`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) {
    throw new Error(`Файл больше ${Math.round(maxBytes / 1024 / 1024)} МБ.`);
  }
  return buffer;
}

/**
 * Отправляет текстовый файл. multipart собирается нативными FormData и Blob.
 * @param {string} token
 * @param {number|string} chatId
 * @param {{name: string, content: string, caption?: string}} file
 */
export async function sendDocument(token, chatId, file) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('document', new Blob([file.content], { type: 'text/plain' }), file.name);
  if (file.caption) {
    form.append('caption', file.caption);
    form.append('parse_mode', 'HTML');
  }

  const response = await fetch(`${API_BASE}/bot${token}/sendDocument`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new TelegramApiError('sendDocument', data.description ?? `HTTP ${response.status}`);
  }
  return data.result;
}
