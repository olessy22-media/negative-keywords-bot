/**
 * Слой 1: разбор запроса правилами, без ИИ.
 * Результат — либо совпадение с указанием корня и уверенности, либо null.
 */

import { normalizeTerm } from '../parser/text.js';
import { isOwnBrand, matchCompetitor } from './competitors.js';
import { buildAllowedGeo, buildGeoMatcher, matchForeignGeo } from './geo.js';
import { geoReference, stopwordsDictionary } from './dictionaries.js';
import { buildStopwordMatcher, matchStopword } from './stopwords.js';

/**
 * Готовит движок правил под конкретный профиль проекта.
 * @param {object} profile профиль проекта
 * @returns {{evaluate: (searchTerm: string) => object|null}}
 */
export function createRuleEngine(profile) {
  const stopwordMatcher = buildStopwordMatcher(stopwordsDictionary);
  const geoMatcher = buildGeoMatcher(geoReference);
  const allowedGeo = buildAllowedGeo(profile.geo, geoMatcher);

  /**
   * @param {string} searchTerm исходный текст запроса
   * @returns {object|null} совпадение правил или null, если правила молчат
   */
  function evaluate(searchTerm) {
    const normalized = normalizeTerm(searchTerm);

    // Собственный бренд неприкосновенен: он важнее любого другого совпадения.
    if (isOwnBrand(normalized, profile.ownBrand)) {
      return {
        source: 'ownBrand',
        root: normalizeTerm(profile.ownBrand),
        group: 'ownBrand',
        reason: 'запрос по вашему бренду',
        scope: 'campaign',
        confidence: 'protected',
      };
    }

    // Бренды конкурентов идут первыми: по разбору живых данных это самая
    // дорогая группа, и минусовать надо именно бренд, а не общее слово рядом.
    return (
      matchCompetitor(normalized, profile.competitors) ??
      matchStopword(normalized, stopwordMatcher) ??
      matchForeignGeo(normalized, geoMatcher, allowedGeo)
    );
  }

  return { evaluate };
}
