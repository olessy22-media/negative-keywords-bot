import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { analyzeSearchTerms } from '../src/analysis/analyze.js';
import { normalizeProfile } from '../src/profiles/profile.js';
import { parseSearchTermsCsv } from '../src/parser/searchTerms.js';
import {
  formatNegativeKeywordsFile,
  formatReviewFile,
  formatSummary,
} from '../src/report/format.js';

const repoFile = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)));

const CONFIG = {
  ai: { apiKey: '', model: 'test', maxTermsToAi: 200, batchSize: 100, timeoutMs: 1000 },
  analysis: { minSpendForMoneyFlag: 1 },
  limits: { maxCsvRows: 20000 },
};

const profile = normalizeProfile(JSON.parse(repoFile('sample/demo-profile.json').toString('utf8')));
const parsed = parseSearchTermsCsv(repoFile('sample/search-terms-sample.csv'), {
  maxRows: CONFIG.limits.maxCsvRows,
});

test('демо-набор разбирается: формат, служебные строки, кампании', () => {
  assert.equal(parsed.terms.length, 48);
  assert.equal(parsed.totals.length, 5);
  assert.equal(parsed.meta.hasCampaignColumn, true);
  assert.equal(parsed.meta.currency, 'USD');
  assert.equal(parsed.terms.filter((term) => term.campaignType === 'pmax').length, 10);
});

test('демо-набор проходит полный путь и даёт все блоки отчёта', async () => {
  const report = await analyzeSearchTerms(parsed, profile, CONFIG);

  assert.ok(report.summary.rootsCount > 0, 'минус-слова найдены');
  assert.ok(report.campaigns.length >= 2, 'результат разложен по кампаниям');
  assert.ok(report.accountRoots.length > 0, 'есть блок общего минус-списка аккаунта');
  assert.equal(report.pmax.count, 10, 'PMax вынесен отдельно');
  assert.ok(report.hiddenTerms.cost > 0, 'скрытые запросы учтены');

  const summary = formatSummary(report, profile);
  const negatives = formatNegativeKeywordsFile(report, profile);
  const review = formatReviewFile(report, profile);

  assert.ok(summary.length <= 4096, 'сводка помещается в одно сообщение Telegram');
  assert.match(negatives, /ОБЩИЙ МИНУС-СПИСОК АККАУНТА/);
  assert.match(negatives, /КАМПАНИЯ: Search \| Flower Delivery/);
  assert.match(review, /НЕ МИНУСОВАТЬ/);
  assert.match(review, /PERFORMANCE MAX/);
});

test('демо-набор: конвертящие запросы и их корни защищены', async () => {
  const report = await analyzeSearchTerms(parsed, profile, CONFIG);
  const negatives = formatNegativeKeywordsFile(report, profile);
  const converting = parsed.terms.filter((term) => term.conversions > 0);

  assert.ok(converting.length > 0, 'в демо-наборе есть запросы с конверсиями');

  const proposedRoots = report.accountRoots
    .concat(report.campaigns.flatMap((campaign) => campaign.roots))
    .map((root) => root.root);

  for (const root of proposedRoots) {
    for (const term of converting) {
      assert.ok(
        !` ${term.searchTerm.toLowerCase()} `.includes(` ${root} `),
        `корень «${root}» задевает конвертящий запрос «${term.searchTerm}»`,
      );
    }
  }

  assert.ok(!negatives.includes('\nfree\n'), 'слово free заблокировано конвертящим запросом');
});

test('демо-набор: бренды конкурентов и чужое гео попали в минус-слова', async () => {
  const report = await analyzeSearchTerms(parsed, profile, CONFIG);
  const roots = report.campaigns.flatMap((campaign) => campaign.roots).map((root) => root.root);

  assert.ok(roots.includes('teleflora'), 'бренд конкурента найден');
  assert.ok(roots.includes('texas'), 'чужой штат найден');
  assert.ok(!roots.some((root) => root.includes('bloomline')), 'свой бренд не минусуется');
});
