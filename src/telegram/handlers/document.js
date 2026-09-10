/**
 * Приём CSV-файла и выдача разбора.
 * Содержимое файла и тексты запросов не логируются: это данные клиентов.
 */

import { analyzeSearchTerms } from '../../analysis/analyze.js';
import { getProfile, getSelectedSlug, listProfileSlugs } from '../../profiles/store.js';
import { parseSearchTermsCsv } from '../../parser/searchTerms.js';
import {
  escapeHtml,
  formatNegativeKeywordsFile,
  formatReviewFile,
  formatSummary,
} from '../../report/format.js';
import { UserFacingError } from '../../errors.js';
import { downloadFile, getFile, sendDocument, sendMessage } from '../api.js';

const ACCEPTED_EXTENSION = /\.csv$/i;

/**
 * Находит профиль для разбора: выбранный явно, а если выбора нет и проект
 * ровно один — его. Иначе просит выбрать: разбор без профиля бессмысленен.
 * @returns {Promise<object|null>}
 */
async function resolveProfile(config, chatId, token) {
  const slugs = await listProfileSlugs(config, chatId);

  if (slugs.length === 0) {
    await sendMessage(
      token,
      chatId,
      'Сначала создайте профиль проекта: /newproject Имя проекта.\n' +
        'Без него бот не знает, что для вас мусор.',
    );
    return null;
  }

  const selected = (await getSelectedSlug(config, chatId)) || (slugs.length === 1 ? slugs[0] : '');
  if (!selected) {
    await sendMessage(token, chatId, 'Выберите активный проект командой /projects.');
    return null;
  }

  const profile = await getProfile(config, chatId, selected);
  if (!profile) {
    await sendMessage(token, chatId, 'Активный проект не найден. Выберите заново: /projects.');
    return null;
  }
  return profile;
}

/**
 * Разбирает CSV и переводит ошибки в безопасный текст. Экспортируется ради
 * теста: именно здесь проходит граница между данными клиента и логами.
 * Сообщения csv-parse могут содержать фрагмент разбираемой строки, то есть
 * данные клиента, поэтому наружу они в исходном виде не выпускаются.
 * @throws {UserFacingError}
 */
export function parseCsvSafely(content, maxRows) {
  try {
    return parseSearchTermsCsv(content, { maxRows });
  } catch (error) {
    if (error instanceof RangeError || /^(Не найдена|Файл пуст|В файле|Заголовки)/.test(error.message)) {
      throw new UserFacingError(error.message, { cause: error });
    }
    throw new UserFacingError(
      'Не удалось разобрать CSV. Проверьте, что файл выгружен как CSV (не «Excel CSV») и не редактировался.',
      { cause: error },
    );
  }
}

/**
 * Полный путь обработки документа: проверки, скачивание, разбор, ответ.
 * @param {object} config
 * @param {number|string} chatId
 * @param {object} document объект document из update Telegram
 */
export async function handleDocument(config, chatId, document) {
  const token = config.telegram.botToken;
  const fileName = String(document.file_name ?? '');

  if (!ACCEPTED_EXTENSION.test(fileName)) {
    await sendMessage(
      token,
      chatId,
      'Нужен файл .csv — выгрузка отчёта «Поисковые запросы» из Google Ads.',
    );
    return;
  }

  if (Number(document.file_size ?? 0) > config.limits.maxFileBytes) {
    const limitMb = Math.round(config.limits.maxFileBytes / 1024 / 1024);
    await sendMessage(token, chatId, `Файл больше ${limitMb} МБ — выгрузите отчёт за меньший период.`);
    return;
  }

  const profile = await resolveProfile(config, chatId, token);
  if (!profile) return;

  await sendMessage(
    token,
    chatId,
    `Файл принят, обрабатываю по проекту <b>${escapeHtml(profile.name)}</b>. Это займёт до минуты.`,
  );

  const file = await getFile(token, document.file_id);
  const content = await downloadFile(token, file.file_path, config.limits.maxFileBytes);

  const parsed = parseCsvSafely(content, config.limits.maxCsvRows);
  const report = await analyzeSearchTerms(parsed, profile, config);
  const stamp = new Date().toISOString().slice(0, 10);

  await sendMessage(token, chatId, formatSummary(report, profile));

  await sendDocument(token, chatId, {
    name: `negative-keywords-${profile.slug}-${stamp}.txt`,
    content: formatNegativeKeywordsFile(report, profile),
    caption: 'Минус-слова по кампаниям и общий список аккаунта.',
  });

  await sendDocument(token, chatId, {
    name: `review-${profile.slug}-${stamp}.txt`,
    content: formatReviewFile(report, profile),
    caption: 'Сомнительные, релевантные без конверсий, PMax и скрытые запросы.',
  });
}
