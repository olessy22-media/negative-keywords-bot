/**
 * Оркестратор разбора: три слоя от разобранного CSV до готового отчёта.
 * Собственных правил не содержит — только порядок их применения.
 */

import { classifyTerms } from '../ai/classifier.js';
import { createRuleEngine } from '../rules/index.js';
import { findHiddenTermsTotal } from '../parser/searchTerms.js';
import { normalizeTerm } from '../parser/text.js';
import { roundMoney } from '../parser/numbers.js';
import { aggregateRoots, groupRootsByCampaign } from './roots.js';

/** По расходу убыванием, затем по показам: в модель уходят самые дорогие. */
function byMoneyThenImpressions(a, b) {
  return b.cost - a.cost || b.impressions - a.impressions;
}

function sumCost(terms) {
  return roundMoney(terms.reduce((total, term) => total + term.cost, 0));
}

/**
 * Раскладывает запросы по корзинам до применения правил.
 * Порядок проверок важен: он же задаёт приоритет требований брифа.
 */
function partition(terms, minSpendForMoneyFlag) {
  const buckets = { pmax: [], alreadyHandled: [], converting: [], workable: [] };

  for (const term of terms) {
    const enriched = { ...term, normalized: normalizeTerm(term.searchTerm) };
    enriched.moneyFlag = enriched.cost > minSpendForMoneyFlag && enriched.conversions === 0;

    if (term.campaignType === 'pmax') buckets.pmax.push(enriched);
    else if (term.addedExcluded !== 'none') buckets.alreadyHandled.push(enriched);
    else if (term.conversions > 0) buckets.converting.push(enriched);
    else buckets.workable.push(enriched);
  }

  return buckets;
}

/**
 * Полный разбор выгрузки.
 * @param {{terms: object[], totals: object[], meta: object}} parsed результат парсера
 * @param {object} profile профиль проекта
 * @param {object} config конфигурация приложения
 * @param {{classify?: Function}} [deps] подмена смыслового слоя (нужна тестам)
 * @returns {Promise<object>} отчёт для отправки пользователю
 */
export async function analyzeSearchTerms(parsed, profile, config, deps = {}) {
  const classify = deps.classify ?? classifyTerms;
  const buckets = partition(parsed.terms, config.analysis.minSpendForMoneyFlag);
  const engine = createRuleEngine(profile);

  // Защищено всё, по чему были конверсии, — включая PMax и уже обработанные
  // строки: общий минус-список аккаунта достаёт и до них.
  const protectedTerms = parsed.terms
    .filter((term) => term.conversions > 0)
    .map((term) => ({ searchTerm: term.searchTerm, normalized: normalizeTerm(term.searchTerm) }));

  const candidates = [];
  const unresolved = [];
  const doubtful = [];
  const relevantNoConversions = [];

  for (const term of buckets.workable) {
    const hit = engine.evaluate(term.searchTerm);

    if (hit?.confidence === 'protected') {
      protectedTerms.push({ searchTerm: term.searchTerm, normalized: term.normalized });
      continue;
    }
    if (hit?.confidence === 'high') {
      candidates.push({ ...term, ...hit });
      continue;
    }
    // Спорные совпадения правил не решают судьбу запроса сами: их проверяет ИИ,
    // а без ИИ они уходят человеку вместе с причиной.
    unresolved.push({ ...term, ruleHit: hit ?? null });
  }

  const forAi = [...unresolved].sort(byMoneyThenImpressions).slice(0, config.ai.maxTermsToAi);
  const aiResult = await classify(
    forAi.map((term) => term.searchTerm),
    profile,
    config.ai,
  );

  for (const term of unresolved) {
    const verdict = aiResult.verdicts.get(term.searchTerm);

    if (verdict?.verdict === 'irrelevant' && verdict.negativeRoot) {
      candidates.push({
        ...term,
        source: 'ai',
        root: verdict.negativeRoot,
        group: 'ai',
        reason: verdict.reason || 'нерелевантный запрос',
        scope: 'campaign',
      });
      continue;
    }

    if (verdict?.verdict === 'relevant') {
      if (term.moneyFlag) {
        relevantNoConversions.push({ ...term, reason: verdict.reason || 'релевантный запрос' });
      }
      continue;
    }

    if (verdict?.verdict === 'irrelevant' || verdict?.verdict === 'doubtful') {
      doubtful.push({
        ...term,
        reason: verdict.reason || 'модель не смогла решить однозначно',
      });
      continue;
    }

    // Вердикта нет: либо ИИ недоступен, либо запрос не попал в лимит MAX_TERMS_TO_AI.
    if (term.ruleHit) {
      doubtful.push({ ...term, reason: term.ruleHit.reason });
    } else if (term.moneyFlag) {
      doubtful.push({ ...term, reason: 'расход без конверсий, смысловой разбор не выполнен' });
    }
  }

  const { roots, rejected } = aggregateRoots(candidates, protectedTerms);
  for (const item of rejected) doubtful.push(item);

  doubtful.sort(byMoneyThenImpressions);
  relevantNoConversions.sort(byMoneyThenImpressions);

  const accountRoots = roots.filter((root) => root.scope === 'account');
  const campaignGroups = groupRootsByCampaign(roots);
  const acceptedTermsCount = roots.reduce((total, root) => total + root.termsCount, 0);

  return {
    summary: {
      currency: parsed.meta.currency,
      totalTerms: parsed.terms.length,
      totalCost: sumCost(parsed.terms),
      searchTerms: parsed.terms.length - buckets.pmax.length,
      pmaxTerms: buckets.pmax.length,
      alreadyHandled: buckets.alreadyHandled.length,
      converting: buckets.converting.length,
      candidateTerms: acceptedTermsCount,
      candidateCost: roundMoney(roots.reduce((total, root) => total + root.cost, 0)),
      rootsCount: roots.length,
      accountRootsCount: accountRoots.length,
      doubtfulCount: doubtful.length,
      relevantNoConversionsCount: relevantNoConversions.length,
      hasCampaignColumn: parsed.meta.hasCampaignColumn,
    },
    campaigns: campaignGroups,
    accountRoots,
    doubtful,
    relevantNoConversions,
    pmax: {
      count: buckets.pmax.length,
      cost: sumCost(buckets.pmax),
      terms: [...buckets.pmax].sort(byMoneyThenImpressions),
    },
    hiddenTerms: findHiddenTermsTotal(parsed.totals),
    ai: {
      available: aiResult.available,
      partial: aiResult.partial,
      error: aiResult.error,
      sentCount: aiResult.available ? forAi.length : 0,
      skippedCount: unresolved.length - forAi.length,
    },
  };
}
