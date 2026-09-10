import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeSearchTerms } from '../src/analysis/analyze.js';
import { normalizeProfile } from '../src/profiles/profile.js';

const PROFILE = normalizeProfile({
  slug: 'test',
  name: 'Тест',
  sells: 'same-day flower delivery and custom bouquets',
  notDoing: 'не продаём искусственные цветы, не работаем оптом',
  geo: ['Springfield, MO'],
  ownBrand: 'Bloomline',
  competitors: ['Teleflora'],
});

const CONFIG = {
  ai: { apiKey: '', model: 'test', maxTermsToAi: 200, batchSize: 100, timeoutMs: 1000 },
  analysis: { minSpendForMoneyFlag: 1 },
  limits: { maxCsvRows: 20000 },
};

function term(overrides) {
  return {
    searchTerm: 'x',
    matchType: 'Широкое соответствие',
    addedExcluded: 'none',
    campaign: 'Search | Main',
    adGroup: 'Main',
    campaignType: 'search',
    clicks: 1,
    impressions: 10,
    cost: 5,
    conversions: 0,
    currency: 'USD',
    ...overrides,
  };
}

function parsedFrom(terms, totals = []) {
  return { terms, totals, meta: { headerRowIndex: 0, hasCampaignColumn: true, currency: 'USD' } };
}

/** Заглушка смыслового слоя: отдаёт заранее заданные вердикты. */
function fakeAi(verdictsByTerm) {
  return async (terms) => ({
    available: true,
    partial: false,
    error: '',
    verdicts: new Map(
      terms
        .filter((text) => verdictsByTerm[text])
        .map((text) => [text, { term: text, ...verdictsByTerm[text] }]),
    ),
  });
}

const rootsOf = (report) => report.accountRoots.concat(
  report.campaigns.flatMap((campaign) => campaign.roots),
).map((root) => root.root);

test('запрос с конверсиями не предлагается в минус ни при каких условиях', async () => {
  const parsed = parsedFrom([
    term({ searchTerm: 'free bouquet quote', conversions: 3, cost: 50 }),
    term({ searchTerm: 'free bouquet samples', conversions: 0, cost: 20 }),
  ]);

  const report = await analyzeSearchTerms(parsed, PROFILE, CONFIG);

  assert.equal(report.summary.rootsCount, 0, 'корень «free» есть в конвертящем запросе');
  assert.ok(
    report.doubtful.some((item) => /встречается в запросе с конверсиями/.test(item.reason)),
    'кандидат должен уйти к человеку с объяснением',
  );
});

test('строки «Добавлено» и «Исключено» в кандидаты не попадают', async () => {
  const parsed = parsedFrom([
    term({ searchTerm: 'free flowers', addedExcluded: 'added' }),
    term({ searchTerm: 'diy bouquets', addedExcluded: 'excluded' }),
    term({ searchTerm: 'used wedding decor', addedExcluded: 'none' }),
  ]);

  const report = await analyzeSearchTerms(parsed, PROFILE, CONFIG);

  assert.equal(report.summary.alreadyHandled, 2);
  assert.deepEqual(rootsOf(report), ['used']);
});

test('PMax вынесен отдельно и без предложений', async () => {
  const parsed = parsedFrom([
    term({ searchTerm: 'free flowers pmax', campaignType: 'pmax', cost: 30 }),
    term({ searchTerm: 'free flowers search', campaignType: 'search', cost: 10 }),
  ]);

  const report = await analyzeSearchTerms(parsed, PROFILE, CONFIG);

  assert.equal(report.pmax.count, 1);
  assert.equal(report.pmax.cost, 30);
  assert.equal(report.summary.candidateTerms, 1, 'кандидат только из поисковой кампании');
});

test('релевантный запрос без конверсий идёт отдельным блоком, а не в минус', async () => {
  const parsed = parsedFrom([term({ searchTerm: 'flower delivery near me', cost: 40 })]);

  const report = await analyzeSearchTerms(parsed, PROFILE, CONFIG, {
    classify: fakeAi({
      'flower delivery near me': {
        verdict: 'relevant',
        reason: 'целевой запрос, вопрос лендинга',
        negativeRoot: '',
      },
    }),
  });

  assert.equal(report.summary.rootsCount, 0);
  assert.equal(report.relevantNoConversions.length, 1);
  assert.equal(report.relevantNoConversions[0].searchTerm, 'flower delivery near me');
});

test('вердикт irrelevant без безопасного корня уходит к человеку, а не в минус', async () => {
  const parsed = parsedFrom([term({ searchTerm: 'dried flower stems only' })]);

  const report = await analyzeSearchTerms(parsed, PROFILE, CONFIG, {
    classify: fakeAi({
      'dried flower stems only': { verdict: 'irrelevant', reason: 'не тот товар', negativeRoot: '' },
    }),
  });

  assert.equal(report.summary.rootsCount, 0);
  assert.equal(report.doubtful.length, 1);
});

test('минус-слова сведены по корням с числом запросов и суммой расхода', async () => {
  const parsed = parsedFrom([
    term({ searchTerm: 'free flower delivery', cost: 10 }),
    term({ searchTerm: 'free flower samples', cost: 15 }),
    term({ searchTerm: 'florist jobs hiring', cost: 7 }),
  ]);

  const report = await analyzeSearchTerms(parsed, PROFILE, CONFIG);
  const free = report.accountRoots.find((root) => root.root === 'free');

  assert.equal(free.termsCount, 2);
  assert.equal(free.cost, 25);
  assert.equal(report.summary.accountRootsCount, 2, 'free и jobs — универсальный мусор');
});

test('результат разложен по кампаниям', async () => {
  const parsed = parsedFrom([
    term({ searchTerm: 'used wedding decor', campaign: 'Search | Delivery', cost: 12 }),
    term({ searchTerm: 'wholesale roses bulk order', campaign: 'Search | Weddings', cost: 30 }),
  ]);

  const report = await analyzeSearchTerms(parsed, PROFILE, CONFIG);

  assert.deepEqual(
    report.campaigns.map((campaign) => campaign.name),
    ['Search | Weddings', 'Search | Delivery'],
    'кампании отсортированы по деньгам',
  );
});

test('собственный бренд защищён, бренд конкурента — кандидат', async () => {
  const parsed = parsedFrom([
    term({ searchTerm: 'bloomline flowers shop', cost: 20 }),
    term({ searchTerm: 'teleflora reviews', cost: 25 }),
  ]);

  const report = await analyzeSearchTerms(parsed, PROFILE, CONFIG);

  assert.deepEqual(rootsOf(report), ['teleflora']);
});

test('при недоступном ИИ отдаётся слой правил и честный статус', async () => {
  const parsed = parsedFrom([
    term({ searchTerm: 'free flowers', cost: 10 }),
    term({ searchTerm: 'anniversary flowers', cost: 40 }),
  ]);

  const report = await analyzeSearchTerms(parsed, PROFILE, CONFIG);

  assert.equal(report.ai.available, false);
  assert.match(report.ai.error, /GEMINI_API_KEY/);
  assert.deepEqual(rootsOf(report), ['free']);
  assert.ok(
    report.doubtful.some((item) => item.searchTerm === 'anniversary flowers'),
    'запрос с расходом и без разбора не теряется, а уходит к человеку',
  );
});

test('расход по скрытым запросам попадает в отчёт', async () => {
  const parsed = parsedFrom(
    [term({ searchTerm: 'free flowers' })],
    [{ label: 'Итого (Другие поисковые запросы)', cost: 542.72, clicks: 78, impressions: 1266 }],
  );

  const report = await analyzeSearchTerms(parsed, PROFILE, CONFIG);
  assert.equal(report.hiddenTerms.cost, 542.72);
});
