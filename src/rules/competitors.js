/**
 * Слой правил: бренды конкурентов и защита собственного бренда.
 * По разбору живых данных бренды конкурентов — самая дорогая группа мусора,
 * поэтому список из профиля проекта здесь основной источник экономии.
 */

import { containsPhrase, normalizeTerm } from '../parser/text.js';

/** @returns {object|null} совпадение с брендом конкурента */
export function matchCompetitor(normalizedTerm, competitors) {
  for (const brand of competitors ?? []) {
    const normalizedBrand = normalizeTerm(brand);
    if (!normalizedBrand) continue;
    if (containsPhrase(normalizedTerm, normalizedBrand)) {
      return {
        source: 'competitors',
        root: normalizedBrand,
        group: 'competitors',
        reason: `бренд конкурента: ${brand}`,
        scope: 'campaign',
        confidence: 'high',
      };
    }
  }
  return null;
}

/** Запрос по собственному бренду не минусуется ни при каких условиях. */
export function isOwnBrand(normalizedTerm, ownBrand) {
  const normalizedBrand = normalizeTerm(ownBrand ?? '');
  if (!normalizedBrand) return false;
  return containsPhrase(normalizedTerm, normalizedBrand);
}
