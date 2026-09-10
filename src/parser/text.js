/**
 * Нормализация текста для устойчивого сравнения.
 *
 * Google Ads пишет заголовок «Kлики» с ЛАТИНСКОЙ K посреди кириллицы —
 * проверено на живой выгрузке. Поэтому сравнивать заголовки как обычные
 * строки нельзя: нужна канонизация омоглифов.
 */

/** Кириллические буквы, визуально неотличимые от латинских (нижний регистр). */
const CYRILLIC_TO_LATIN = {
  а: 'a', б: 'b', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm',
  н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x',
};

const WHITESPACE_RE = /[\s   ​]+/g;

/** Убирает BOM и схлопывает любые пробелы (включая неразрывные) в один. */
export function collapseWhitespace(value) {
  return String(value ?? '')
    .replace(/^﻿/, '')
    .replace(WHITESPACE_RE, ' ')
    .trim();
}

/**
 * Канонизирует строку для сравнения: нижний регистр, омоглифы к латинице,
 * прочь всё, кроме букв и цифр. «Kлики» (лат. K) и «Клики» (кир. К) дают
 * одинаковый результат.
 * @param {string} value
 * @returns {string}
 */
export function canonicalize(value) {
  const lowered = collapseWhitespace(value).toLowerCase();
  let result = '';
  for (const char of lowered) {
    const mapped = CYRILLIC_TO_LATIN[char] ?? char;
    if (/[\p{L}\p{N}]/u.test(mapped)) result += mapped;
  }
  return result;
}

/**
 * Приводит поисковый запрос к виду, удобному для поиска подстрок по словам:
 * нижний регистр, любая пунктуация становится пробелом.
 * Регистр слов сохраняется в исходном виде отдельно — это только для матчинга.
 * @param {string} value
 * @returns {string}
 */
export function normalizeTerm(value) {
  return collapseWhitespace(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Проверяет вхождение фразы в запрос по границам слов.
 * «free» найдётся в «free quote», но не в «freezer».
 * @param {string} normalizedTerm результат normalizeTerm
 * @param {string} phrase искомая фраза (будет нормализована)
 * @returns {boolean}
 */
export function containsPhrase(normalizedTerm, phrase) {
  const needle = normalizeTerm(phrase);
  if (!needle) return false;
  return ` ${normalizedTerm} `.includes(` ${needle} `);
}
