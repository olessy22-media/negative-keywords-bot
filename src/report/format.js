/**
 * Отрисовка отчёта: сводка сообщением и два текстовых файла.
 * Решений о минусовке здесь нет — только представление готового результата.
 */

import { formatMoney } from '../parser/numbers.js';

const TELEGRAM_MESSAGE_LIMIT = 4096;
const MAX_ROWS_PER_BLOCK = 300;
const NO_CAMPAIGN_LABEL = 'Кампания не указана в выгрузке';

/** Экранирует значения для parse_mode=HTML: в запросах бывают < > &. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function plural(count, one, few, many) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function money(value, currency) {
  return currency ? `${formatMoney(value)} ${currency}` : formatMoney(value);
}

function aiStatusLine(ai) {
  if (!ai.available) {
    return `⚠️ Смысловой разбор недоступен (${ai.error}). Показан результат слоя правил.`;
  }
  const parts = [`🧠 Смысловой разбор: ${ai.sentCount} ${plural(ai.sentCount, 'запрос', 'запроса', 'запросов')}`];
  if (ai.skippedCount > 0) parts.push(`вне лимита осталось ${ai.skippedCount}`);
  if (ai.partial) parts.push('часть пакетов не ответила');
  return parts.join(', ') + '.';
}

/**
 * Сводка для сообщения в Telegram (parse_mode=HTML).
 * @param {object} report результат analyzeSearchTerms
 * @param {object} profile профиль проекта
 * @returns {string}
 */
export function formatSummary(report, profile) {
  const { summary, ai, hiddenTerms } = report;
  const currency = summary.currency;

  const lines = [
    `<b>Разбор поисковых запросов</b> — проект «${escapeHtml(profile.name)}»`,
    '',
    `Проверено запросов: <b>${summary.totalTerms}</b> на ${escapeHtml(money(summary.totalCost, currency))}`,
    `· поиск: ${summary.searchTerms}, Performance Max: ${summary.pmaxTerms}`,
    `· уже добавлены или заминусованы: ${summary.alreadyHandled} — в кандидаты не берутся`,
    `· с конверсиями: ${summary.converting} — в минус не предлагаются никогда`,
    '',
    `<b>Кандидаты в минус:</b> ${summary.candidateTerms} ${plural(summary.candidateTerms, 'запрос', 'запроса', 'запросов')} на ${escapeHtml(money(summary.candidateCost, currency))}`,
    `<b>Минус-слов получилось:</b> ${summary.rootsCount} (из них в общий список аккаунта: ${summary.accountRootsCount})`,
    '',
    `🤔 Сомнительные — решает человек: ${summary.doubtfulCount}`,
    `✋ Релевантные без конверсий — <b>не минусовать</b>: ${summary.relevantNoConversionsCount}`,
    `ℹ️ Performance Max: ${report.pmax.count} на ${escapeHtml(money(report.pmax.cost, currency))} — без предложений`,
  ];

  if (hiddenTerms) {
    lines.push(
      '',
      `⚠️ Google скрывает часть запросов: «${escapeHtml(hiddenTerms.label)}» — ${escapeHtml(money(hiddenTerms.cost, currency))}. Этот расход минусовке недоступен.`,
    );
  }

  if (!summary.hasCampaignColumn) {
    lines.push('', 'ℹ️ В выгрузке нет колонки «Кампания» — минус-слова собраны в один список.');
  }

  lines.push('', aiStatusLine(ai), '', 'Бот ничего не менял в кабинете: минус-слова вставляете вы.');

  const text = lines.join('\n');
  return text.length > TELEGRAM_MESSAGE_LIMIT
    ? `${text.slice(0, TELEGRAM_MESSAGE_LIMIT - 3)}...`
    : text;
}

function renderRootBlock(title, subtitle, roots, currency) {
  if (roots.length === 0) return [];
  return [
    '',
    `## ${title}`,
    `# ${subtitle}`,
    '',
    '--- для вставки в кабинет ---',
    ...roots.slice(0, MAX_ROWS_PER_BLOCK).map((root) => root.root),
    '',
    '--- расшифровка ---',
    ...roots
      .slice(0, MAX_ROWS_PER_BLOCK)
      .map(
        (root) =>
          `${root.root} — ${root.termsCount} ${plural(root.termsCount, 'запрос', 'запроса', 'запросов')}, ` +
          `${money(root.cost, currency)} — ${root.reason}`,
      ),
  ];
}

/**
 * Файл минус-слов: общий список аккаунта плюс блоки по кампаниям.
 * @param {object} report
 * @param {object} profile
 * @returns {string}
 */
export function formatNegativeKeywordsFile(report, profile) {
  const currency = report.summary.currency;
  const lines = [
    '# МИНУС-СЛОВА ПО ОТЧЁТУ «ПОИСКОВЫЕ ЗАПРОСЫ»',
    `# Проект: ${profile.name}`,
    `# Дата разбора: ${new Date().toISOString().slice(0, 10)}`,
    '#',
    '# Бот ничего не менял в рекламном кабинете. Слова вставляете вы, вручную.',
    '# Уровень добавления — кампания. Общий блок ниже предназначен для',
    '# минус-списка на уровне аккаунта.',
  ];

  lines.push(
    ...renderRootBlock(
      'ОБЩИЙ МИНУС-СПИСОК АККАУНТА',
      'универсальный мусор: подходит любой кампании аккаунта',
      report.accountRoots,
      currency,
    ),
  );

  for (const campaign of report.campaigns) {
    lines.push(
      ...renderRootBlock(
        `КАМПАНИЯ: ${campaign.name || NO_CAMPAIGN_LABEL}`,
        `${campaign.roots.length} ${plural(campaign.roots.length, 'корень', 'корня', 'корней')}, ${money(campaign.cost, currency)}`,
        campaign.roots,
        currency,
      ),
    );
  }

  if (report.accountRoots.length === 0 && report.campaigns.length === 0) {
    lines.push('', '# Кандидатов в минус-слова не найдено.');
  }

  return `${lines.join('\n')}\n`;
}

function renderTermRows(terms, currency) {
  return terms
    .slice(0, MAX_ROWS_PER_BLOCK)
    .map(
      (term) =>
        `${term.searchTerm}\t${money(term.cost, currency)}\t${term.clicks} кл.\t${term.impressions} показ.` +
        (term.reason ? `\t${term.reason}` : ''),
    );
}

/**
 * Файл ручного разбора: сомнительные, релевантные без конверсий, PMax, скрытые.
 * @param {object} report
 * @param {object} profile
 * @returns {string}
 */
export function formatReviewFile(report, profile) {
  const currency = report.summary.currency;
  const lines = [
    '# РУЧНОЙ РАЗБОР',
    `# Проект: ${profile.name}`,
    `# Дата разбора: ${new Date().toISOString().slice(0, 10)}`,
    '# Колонки: запрос / расход / клики / показы / причина',
    '',
    '=== БЛОК 1. СОМНИТЕЛЬНЫЕ — решает человек ===',
    `# ${report.doubtful.length} ${plural(report.doubtful.length, 'запрос', 'запроса', 'запросов')}. Правила и модель не дали однозначного ответа.`,
    '',
    ...renderTermRows(report.doubtful, currency),
    '',
    '=== БЛОК 2. РЕЛЕВАНТНЫЕ, НО БЕЗ КОНВЕРСИЙ — НЕ МИНУСОВАТЬ ===',
    '# Это целевой трафик, который не превратился в заявку.',
    '# Минусовка здесь режет продажи. Работать надо лендингом и ставками.',
    `# ${report.relevantNoConversions.length} ${plural(report.relevantNoConversions.length, 'запрос', 'запроса', 'запросов')}.`,
    '',
    ...renderTermRows(report.relevantNoConversions, currency),
    '',
    '=== БЛОК 3. PERFORMANCE MAX — информационно ===',
    '# Предложений по PMax бот не делает: минусовка там работает иначе.',
    `# ${report.pmax.count} ${plural(report.pmax.count, 'запрос', 'запроса', 'запросов')} на ${money(report.pmax.cost, currency)}.`,
    '',
    ...renderTermRows(report.pmax.terms, currency),
    '',
    '=== БЛОК 4. СКРЫТЫЕ ЗАПРОСЫ ===',
  ];

  if (report.hiddenTerms) {
    lines.push(
      `# Google агрегирует часть запросов и не показывает их поштучно.`,
      `# «${report.hiddenTerms.label}»: ${money(report.hiddenTerms.cost, currency)}, ` +
        `${report.hiddenTerms.clicks} кликов, ${report.hiddenTerms.impressions} показов.`,
      '# Этот расход минусовке недоступен — ни ботом, ни руками.',
    );
  } else {
    lines.push('# В выгрузке нет строки со скрытыми запросами.');
  }

  return `${lines.join('\n')}\n`;
}
