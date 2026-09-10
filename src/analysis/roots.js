/**
 * Слой 3: свод минус-слов по корням.
 *
 * В кабинет вставляют не фразы, а корни: одно слово «free» вместо сорока
 * фраз с ним. Отсюда же главная защита: корень, который встречается хотя бы
 * в одном конвертящем запросе, в минус не идёт никогда — иначе инструмент
 * режет целевой трафик.
 */

import { containsPhrase } from '../parser/text.js';
import { roundMoney } from '../parser/numbers.js';

/**
 * @param {object[]} candidates кандидаты с полями root, scope, reason и метриками
 * @param {object[]} protectedTerms запросы, которые нельзя задеть (с конверсиями, свой бренд)
 * @returns {{roots: object[], rejected: object[]}} корни и отклонённые защитой кандидаты
 */
export function aggregateRoots(candidates, protectedTerms) {
  const byRoot = new Map();

  for (const candidate of candidates) {
    if (!candidate.root) continue;
    let entry = byRoot.get(candidate.root);
    if (!entry) {
      entry = {
        root: candidate.root,
        scope: candidate.scope,
        reasons: new Set(),
        sources: new Set(),
        terms: [],
        cost: 0,
        clicks: 0,
        impressions: 0,
        campaigns: new Map(),
      };
      byRoot.set(candidate.root, entry);
    }

    // Универсальный мусор важнее частного: если корень хоть раз помечен как
    // общий для аккаунта, он идёт в общий минус-список.
    if (candidate.scope === 'account') entry.scope = 'account';
    entry.reasons.add(candidate.reason);
    entry.sources.add(candidate.source);
    entry.terms.push(candidate);
    entry.cost += candidate.cost;
    entry.clicks += candidate.clicks;
    entry.impressions += candidate.impressions;

    const campaignName = candidate.campaign || '';
    const campaign = entry.campaigns.get(campaignName) ?? { terms: 0, cost: 0 };
    campaign.terms += 1;
    campaign.cost += candidate.cost;
    entry.campaigns.set(campaignName, campaign);
  }

  const roots = [];
  const rejected = [];

  for (const entry of byRoot.values()) {
    const blocker = protectedTerms.find((term) => containsPhrase(term.normalized, entry.root));
    if (blocker) {
      for (const candidate of entry.terms) {
        rejected.push({
          ...candidate,
          reason: `корень «${entry.root}» встречается в запросе с конверсиями — минусовать нельзя`,
        });
      }
      continue;
    }

    roots.push({
      root: entry.root,
      scope: entry.scope,
      reason: [...entry.reasons][0] ?? '',
      sources: [...entry.sources],
      termsCount: entry.terms.length,
      cost: roundMoney(entry.cost),
      clicks: entry.clicks,
      impressions: entry.impressions,
      terms: entry.terms.map((candidate) => candidate.searchTerm),
      campaigns: [...entry.campaigns.entries()].map(([name, stats]) => ({
        name,
        termsCount: stats.terms,
        cost: roundMoney(stats.cost),
      })),
    });
  }

  roots.sort((a, b) => b.cost - a.cost || b.termsCount - a.termsCount);
  return { roots, rejected };
}

/**
 * Раскладывает корни по кампаниям для файла минус-слов.
 * @param {object[]} roots результат aggregateRoots
 * @returns {object[]} кампании со своими корнями, самые дорогие первыми
 */
export function groupRootsByCampaign(roots) {
  const byCampaign = new Map();

  for (const root of roots) {
    if (root.scope === 'account') continue;
    for (const campaign of root.campaigns) {
      const key = campaign.name || '';
      const group = byCampaign.get(key) ?? { name: key, roots: [], cost: 0 };
      group.roots.push({
        root: root.root,
        termsCount: campaign.termsCount,
        cost: campaign.cost,
        reason: root.reason,
      });
      group.cost += campaign.cost;
      byCampaign.set(key, group);
    }
  }

  const groups = [...byCampaign.values()];
  for (const group of groups) {
    group.cost = roundMoney(group.cost);
    group.roots.sort((a, b) => b.cost - a.cost || b.termsCount - a.termsCount);
  }
  groups.sort((a, b) => b.cost - a.cost || b.roots.length - a.roots.length);
  return groups;
}
