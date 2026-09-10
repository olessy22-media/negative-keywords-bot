/**
 * Слой правил: несовпадение географии.
 *
 * Чужой ШТАТ — однозначный признак: штат либо в списке разрешённых, либо нет.
 * Чужой ГОРОД — признак спорный: справочник не знает, в каком штате город, а
 * значит не может отличить «город внутри разрешённого штата» от чужого.
 * Поэтому города идут с пониженной уверенностью и попадают к человеку или в ИИ,
 * а не сразу в минус.
 */

import { containsPhrase, normalizeTerm } from '../parser/text.js';

/** Строит матчер географии из справочника. */
export function buildGeoMatcher(reference) {
  const ambiguous = new Set(reference.ambiguousAbbreviations.map((abbr) => abbr.toLowerCase()));
  const entities = [];
  const abbrToState = new Map();
  const stateToAbbr = new Map();

  for (const state of reference.states) {
    const name = normalizeTerm(state.name);
    const abbr = state.abbr.toLowerCase();
    abbrToState.set(abbr, name);
    stateToAbbr.set(name, abbr);
    entities.push({ token: name, kind: 'state', label: state.name });
    if (!ambiguous.has(abbr)) {
      entities.push({ token: abbr, kind: 'state', label: state.abbr });
    }
  }

  for (const city of reference.cities) {
    entities.push({ token: normalizeTerm(city), kind: 'city', label: city });
  }

  // Штаты проверяются раньше городов: «texas» в «flowers dallas texas» —
  // однозначный признак чужого гео, а «dallas» сам по себе только спорный.
  // Внутри вида длинные названия идут первыми: «new york» важнее, чем «york».
  const KIND_ORDER = { state: 0, city: 1 };
  entities.sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.token.length - a.token.length,
  );
  return { entities, abbrToState, stateToAbbr };
}

/**
 * Собирает множество разрешённой географии из профиля.
 * Сокращения штатов раскрываются в полные названия и наоборот: владелец пишет
 * «Springfield, MO», а в запросе может стоять «missouri».
 * @param {string[]} geoList гео из профиля проекта
 * @param {object} matcher результат buildGeoMatcher
 * @returns {Set<string>}
 */
export function buildAllowedGeo(geoList, matcher) {
  const allowed = new Set();
  for (const entry of geoList ?? []) {
    const normalized = normalizeTerm(entry);
    if (!normalized) continue;
    for (const word of normalized.split(' ')) allowed.add(word);
    allowed.add(normalized);

    for (const entity of matcher.entities) {
      if (containsPhrase(normalized, entity.token)) allowed.add(entity.token);
    }
    for (const word of normalized.split(' ')) {
      const stateName = matcher.abbrToState.get(word);
      if (stateName) allowed.add(stateName);
    }
    const abbr = matcher.stateToAbbr.get(normalized);
    if (abbr) allowed.add(abbr);
  }
  return allowed;
}

/**
 * Ищет в запросе географию за пределами разрешённой.
 * @param {string} normalizedTerm
 * @param {object} matcher
 * @param {Set<string>} allowedGeo
 * @returns {object|null}
 */
export function matchForeignGeo(normalizedTerm, matcher, allowedGeo) {
  if (allowedGeo.size === 0) return null;

  for (const entity of matcher.entities) {
    if (allowedGeo.has(entity.token)) continue;
    if (!containsPhrase(normalizedTerm, entity.token)) continue;

    return {
      source: 'geo',
      root: entity.token,
      group: 'geo',
      reason: `география вне зоны работы: ${entity.label}`,
      scope: 'campaign',
      confidence: entity.kind === 'state' ? 'high' : 'medium',
    };
  }
  return null;
}
