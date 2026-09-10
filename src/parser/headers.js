/**
 * Сопоставление заголовков выгрузки с полями модели.
 * Поддержаны русская и английская локали кабинета Google Ads.
 */

import { canonicalize } from './text.js';

/**
 * Описание колонок. `required: true` — без колонки разбор невозможен.
 * Колонки «Кампания» и «Группа объявлений» необязательны: в обезличенной
 * выгрузке их может не быть, а разбор всё равно должен пройти.
 */
export const COLUMN_SCHEMA = {
  searchTerm: { required: true, aliases: ['Поисковый запрос', 'Search term'] },
  matchType: { required: false, aliases: ['Тип соответствия', 'Match type'] },
  addedExcluded: {
    required: true,
    aliases: ['Добавленные/Исключенные', 'Добавленные/Исключённые', 'Added/Excluded'],
  },
  campaign: { required: false, aliases: ['Кампания', 'Campaign'] },
  adGroup: { required: false, aliases: ['Группа объявлений', 'Ad group'] },
  clicks: { required: false, aliases: ['Клики', 'Clicks'] },
  impressions: { required: false, aliases: ['Показы', 'Impr.', 'Impressions'] },
  ctr: { required: false, aliases: ['CTR'] },
  currency: { required: false, aliases: ['Код валюты', 'Currency code'] },
  avgCpc: { required: false, aliases: ['Ср. цена за клик', 'Avg. CPC'] },
  cost: { required: true, aliases: ['Расходы', 'Расход', 'Cost'] },
  campaignType: { required: true, aliases: ['Тип кампании', 'Campaign type'] },
  convRate: { required: false, aliases: ['Коэфф. конверсии', 'Conv. rate'] },
  conversions: { required: true, aliases: ['Конверсии', 'Conversions'] },
  costPerConv: { required: false, aliases: ['Стоимость/конв.', 'Cost / conv.'] },
};

const CANONICAL_ALIASES = new Map();
for (const [field, spec] of Object.entries(COLUMN_SCHEMA)) {
  for (const alias of spec.aliases) {
    CANONICAL_ALIASES.set(canonicalize(alias), field);
  }
}

export const REQUIRED_FIELDS = Object.entries(COLUMN_SCHEMA)
  .filter(([, spec]) => spec.required)
  .map(([field]) => field);

/**
 * Строит карту «поле модели -> индекс колонки» по строке заголовков.
 * @param {string[]} row строка заголовков как массив ячеек
 * @returns {{map: Object<string, number>, matched: number}}
 */
export function mapHeaderRow(row) {
  const map = {};
  let matched = 0;
  row.forEach((cell, index) => {
    const field = CANONICAL_ALIASES.get(canonicalize(cell));
    if (field && map[field] === undefined) {
      map[field] = index;
      matched += 1;
    }
  });
  return { map, matched };
}

/**
 * Ищет строку заголовков среди первых строк файла.
 *
 * В настоящей выгрузке первые две строки — название отчёта и период, но в
 * обезличенном или отредактированном файле их может не быть. Поэтому строка
 * заголовков ищется, а не берётся по фиксированному номеру.
 *
 * @param {string[][]} rows строки CSV
 * @param {number} [lookahead] сколько первых строк просмотреть
 * @returns {{index: number, map: Object<string, number>}}
 * @throws {Error} если заголовки не найдены или нет обязательных колонок
 */
export function findHeaderRow(rows, lookahead = 10) {
  let best = null;
  const limit = Math.min(rows.length, lookahead);

  for (let index = 0; index < limit; index += 1) {
    const { map, matched } = mapHeaderRow(rows[index]);
    const hasRequired = REQUIRED_FIELDS.every((field) => map[field] !== undefined);
    if (hasRequired && (best === null || matched > best.matched)) {
      best = { index, map, matched };
    }
  }

  if (!best) {
    const missingReport = describeMissing(rows, limit);
    throw new Error(
      'Не найдена строка заголовков отчёта «Поисковые запросы». ' +
        `Проверьте, что файл выгружен как CSV (не «Excel CSV»). ${missingReport}`,
    );
  }

  return { index: best.index, map: best.map };
}

/** Подсказка пользователю: каких именно колонок не хватило в лучшей строке. */
function describeMissing(rows, limit) {
  let bestMatched = -1;
  let missing = REQUIRED_FIELDS;
  for (let index = 0; index < limit; index += 1) {
    const { map, matched } = mapHeaderRow(rows[index]);
    if (matched > bestMatched) {
      bestMatched = matched;
      missing = REQUIRED_FIELDS.filter((field) => map[field] === undefined);
    }
  }
  if (missing.length === 0) return '';
  const names = missing.map((field) => COLUMN_SCHEMA[field].aliases[0]);
  return `Не хватает обязательных колонок: ${names.join(', ')}.`;
}
