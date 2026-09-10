/**
 * Слой правил: словарь мусорных запросов.
 * В минус уходит СОВПАВШАЯ ФРАЗА, а не название группы: минус-слово «diy»
 * не остановит показы по «how to make», хотя обе фразы лежат в одной группе.
 */

import { containsPhrase } from '../parser/text.js';

const CONFIDENCE_ORDER = { high: 0, medium: 1 };

/** Раскладывает словарь в плоский список фраз, высокая уверенность — первой. */
export function buildStopwordMatcher(dictionary) {
  const entries = [];
  for (const group of dictionary.groups) {
    for (const phrase of group.phrases) {
      entries.push({
        phrase,
        group: group.root,
        reason: group.reason,
        scope: group.scope,
        confidence: group.confidence,
      });
    }
  }
  entries.sort((a, b) => CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence]);
  return entries;
}

/**
 * @param {string} normalizedTerm результат normalizeTerm
 * @param {object[]} matcher результат buildStopwordMatcher
 * @returns {object|null} совпадение или null
 */
export function matchStopword(normalizedTerm, matcher) {
  for (const entry of matcher) {
    if (containsPhrase(normalizedTerm, entry.phrase)) {
      return {
        source: 'stopwords',
        root: entry.phrase,
        group: entry.group,
        reason: entry.reason,
        scope: entry.scope,
        confidence: entry.confidence,
      };
    }
  }
  return null;
}
