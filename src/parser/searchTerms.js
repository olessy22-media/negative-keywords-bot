/**
 * Адаптер формата выгрузки «Поисковые запросы» Google Ads.
 * Задача модуля одна: превратить CSV в массив строк известной формы.
 * Никаких решений о минусовке здесь не принимается.
 */

import { parse } from 'csv-parse/sync';
import { findHeaderRow } from './headers.js';
import { parseNumber } from './numbers.js';
import { canonicalize, collapseWhitespace } from './text.js';

/** Служебные итоговые строки в конце файла: «Итого (Аккаунт)», «Total: ...». */
const TOTALS_PREFIX_RE = /^(итого|total)\s*[(:]/i;

const ADDED_EXCLUDED_VALUES = buildLookup({
  added: ['Добавлено', 'Added'],
  excluded: ['Исключено', 'Исключён', 'Excluded'],
  none: ['Не используется', 'None', '--'],
});

const CAMPAIGN_TYPE_VALUES = buildLookup({
  search: ['Поиск', 'Search'],
  pmax: ['Максимальная эффективность', 'Performance Max'],
});

function buildLookup(groups) {
  const lookup = new Map();
  for (const [key, values] of Object.entries(groups)) {
    for (const value of values) lookup.set(canonicalize(value), key);
  }
  return lookup;
}

function classifyValue(lookup, raw, fallback) {
  return lookup.get(canonicalize(raw)) ?? fallback;
}

/** Читает ячейку по карте заголовков; отсутствующая колонка даёт пустую строку. */
function cell(row, map, field) {
  const index = map[field];
  if (index === undefined) return '';
  return collapseWhitespace(row[index]);
}

/**
 * Разбирает CSV-выгрузку поисковых запросов.
 *
 * @param {string|Buffer} input содержимое файла (UTF-8, BOM допустим)
 * @param {{maxRows?: number}} [options]
 * @returns {{terms: object[], totals: object[], meta: object}}
 * @throws {Error} если формат не распознан или файл слишком велик
 */
export function parseSearchTermsCsv(input, options = {}) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input);

  const rows = parse(text, {
    bom: true,
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
  });

  if (rows.length === 0) {
    throw new Error('Файл пуст: в нём нет ни одной строки.');
  }

  const maxRows = options.maxRows ?? Infinity;
  if (rows.length > maxRows) {
    throw new Error(
      `В файле ${rows.length} строк, это больше допустимого предела ${maxRows}. ` +
        'Выгрузите отчёт за более короткий период.',
    );
  }

  const { index: headerRowIndex, map } = findHeaderRow(rows);

  const terms = [];
  const totals = [];
  let skippedServiceRows = 0;

  for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    const searchTerm = cell(row, map, 'searchTerm');

    if (!searchTerm) {
      skippedServiceRows += 1;
      continue;
    }

    if (TOTALS_PREFIX_RE.test(searchTerm)) {
      totals.push({
        label: searchTerm,
        clicks: parseNumber(cell(row, map, 'clicks')),
        impressions: parseNumber(cell(row, map, 'impressions')),
        cost: parseNumber(cell(row, map, 'cost')),
        conversions: parseNumber(cell(row, map, 'conversions')),
      });
      skippedServiceRows += 1;
      continue;
    }

    terms.push({
      searchTerm,
      matchType: cell(row, map, 'matchType'),
      addedExcluded: classifyValue(ADDED_EXCLUDED_VALUES, cell(row, map, 'addedExcluded'), 'none'),
      campaign: cell(row, map, 'campaign'),
      adGroup: cell(row, map, 'adGroup'),
      campaignType: classifyValue(CAMPAIGN_TYPE_VALUES, cell(row, map, 'campaignType'), 'other'),
      clicks: parseNumber(cell(row, map, 'clicks')),
      impressions: parseNumber(cell(row, map, 'impressions')),
      cost: parseNumber(cell(row, map, 'cost')),
      conversions: parseNumber(cell(row, map, 'conversions')),
      currency: cell(row, map, 'currency'),
    });
  }

  if (terms.length === 0) {
    throw new Error('Заголовки распознаны, но ни одной строки с поисковым запросом не найдено.');
  }

  return {
    terms,
    totals,
    meta: {
      headerRowIndex,
      hasCampaignColumn: map.campaign !== undefined,
      skippedServiceRows,
      currency: terms.find((term) => term.currency)?.currency ?? '',
    },
  };
}

/**
 * Находит итоговую строку по скрытым запросам («Другие поисковые запросы»).
 * Этот расход недоступен для минусовки, и об этом надо честно сказать.
 * @param {object[]} totals
 * @returns {object|null}
 */
export function findHiddenTermsTotal(totals) {
  return (
    totals.find((row) => {
      const canonical = canonicalize(row.label);
      return canonical.includes(canonicalize('Другие')) || canonical.includes('other');
    }) ?? null
  );
}
