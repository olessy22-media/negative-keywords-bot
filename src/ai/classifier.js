/**
 * Общий интерфейс смыслового слоя: classifyTerms(terms, profile).
 * Вызывающий код ничего не знает о провайдере и обязан пережить его недоступность —
 * при отсутствии ключа или отказе API возвращается пустой результат с причиной,
 * а не исключение.
 */

import { normalizeTerm } from '../parser/text.js';
import { classifyBatch } from './gemini.js';

const VALID_VERDICTS = new Set(['relevant', 'irrelevant', 'doubtful']);

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** Отбрасывает вердикты неизвестной формы: ответ модели — внешние данные. */
function sanitize(rawVerdicts, requestedTerms) {
  const requested = new Map(requestedTerms.map((term) => [normalizeTerm(term), term]));
  const clean = new Map();

  for (const item of rawVerdicts) {
    if (!item || typeof item.term !== 'string') continue;
    const originalTerm = requested.get(normalizeTerm(item.term));
    if (!originalTerm) continue;
    if (!VALID_VERDICTS.has(item.verdict)) continue;

    clean.set(originalTerm, {
      term: originalTerm,
      verdict: item.verdict,
      reason: typeof item.reason === 'string' ? item.reason.slice(0, 200) : '',
      negativeRoot:
        item.verdict === 'irrelevant' && typeof item.negative_root === 'string'
          ? normalizeTerm(item.negative_root)
          : '',
    });
  }
  return clean;
}

/**
 * @param {string[]} terms тексты запросов (только текст, ничего больше)
 * @param {object} profile профиль проекта
 * @param {object} aiConfig раздел ai из конфигурации
 * @returns {Promise<{available: boolean, partial: boolean, verdicts: Map<string, object>, error: string}>}
 */
export async function classifyTerms(terms, profile, aiConfig) {
  const empty = { available: false, partial: false, verdicts: new Map(), error: '' };

  if (!aiConfig.apiKey) {
    return { ...empty, error: 'ключ GEMINI_API_KEY не задан' };
  }
  if (terms.length === 0) {
    return { available: true, partial: false, verdicts: new Map(), error: '' };
  }

  const batches = chunk(terms, aiConfig.batchSize);
  const settled = await Promise.allSettled(
    batches.map((batch) =>
      classifyBatch(batch, profile, {
        apiKey: aiConfig.apiKey,
        model: aiConfig.model,
        timeoutMs: aiConfig.timeoutMs,
      }).then((results) => sanitize(results, batch)),
    ),
  );

  const verdicts = new Map();
  const failures = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      for (const [term, verdict] of result.value) verdicts.set(term, verdict);
    } else {
      // Текст запроса в лог не попадает — только номер пакета и причина отказа.
      failures.push(`пакет ${index + 1}: ${result.reason?.message ?? 'неизвестная ошибка'}`);
    }
  });

  if (failures.length === batches.length) {
    return { ...empty, error: failures[0] };
  }

  return {
    available: true,
    partial: failures.length > 0,
    verdicts,
    error: failures.join('; '),
  };
}
