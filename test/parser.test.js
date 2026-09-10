import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { canonicalize, containsPhrase, normalizeTerm } from '../src/parser/text.js';
import { parseNumber } from '../src/parser/numbers.js';
import { findHiddenTermsTotal, parseSearchTermsCsv } from '../src/parser/searchTerms.js';

const fixture = (name) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));

test('canonicalize сводит латинские и кириллические омоглифы', () => {
  assert.equal(canonicalize('Kлики'), canonicalize('Клики'));
  assert.equal(canonicalize('  Расходы  '), canonicalize('расходы'));
  assert.notEqual(canonicalize('Конверсии'), canonicalize('Коэфф. конверсии'));
});

test('normalizeTerm и containsPhrase работают по границам слов', () => {
  assert.equal(normalizeTerm('Free  Flower-Delivery!'), 'free flower delivery');
  assert.ok(containsPhrase(normalizeTerm('free flower delivery'), 'free'));
  assert.ok(containsPhrase(normalizeTerm('do it yourself bouquet'), 'do it yourself'));
  assert.ok(!containsPhrase(normalizeTerm('freezer repair'), 'free'));
});

test('parseNumber понимает обе локали, проценты и разделители тысяч', () => {
  assert.equal(parseNumber('0,00'), 0);
  assert.equal(parseNumber('715,71'), 715.71);
  assert.equal(parseNumber('6,16%'), 6.16);
  assert.equal(parseNumber('1 266'), 1266);
  assert.equal(parseNumber('1,266'), 1266);
  assert.equal(parseNumber('1.266,18'), 1266.18);
  assert.equal(parseNumber('1,266.18'), 1266.18);
  assert.equal(parseNumber(''), 0);
  assert.equal(parseNumber(' - '), 0);
});

test('русская выгрузка: BOM, две служебные строки, латинская K, строки «Итого»', () => {
  const { terms, totals, meta } = parseSearchTermsCsv(fixture('search-terms-ru.csv'));

  assert.equal(meta.headerRowIndex, 2, 'заголовки на третьей строке');
  assert.equal(meta.hasCampaignColumn, true);
  assert.equal(meta.currency, 'USD');
  assert.equal(terms.length, 8);
  assert.equal(totals.length, 5, 'все пять строк «Итого» вынесены из запросов');

  const clicked = terms.find((term) => term.searchTerm === 'free flower delivery');
  assert.equal(clicked.clicks, 12, 'колонка «Kлики» с латинской K прочитана');
  assert.equal(clicked.cost, 18);
  assert.equal(clicked.campaign, 'Search | Flowers');

  const bigNumbers = terms.find((term) => term.searchTerm === 'big thousand roses');
  assert.equal(bigNumbers.impressions, 1266, 'неразрывный пробел как разделитель тысяч');
  assert.equal(bigNumbers.cost, 1234.56);
});

test('русская выгрузка: статусы «Добавлено» и «Исключено» распознаны', () => {
  const { terms } = parseSearchTermsCsv(fixture('search-terms-ru.csv'));
  const statuses = Object.fromEntries(terms.map((term) => [term.searchTerm, term.addedExcluded]));

  assert.equal(statuses['bouquet delivery'], 'added');
  assert.equal(statuses['diy flower arrangement'], 'excluded');
  assert.equal(statuses['free flower delivery'], 'none');
});

test('русская выгрузка: тип кампании разделяет Поиск и PMax', () => {
  const { terms } = parseSearchTermsCsv(fixture('search-terms-ru.csv'));
  const pmax = terms.filter((term) => term.campaignType === 'pmax');
  assert.deepEqual(pmax.map((term) => term.searchTerm), ['flowers springfield']);
});

test('английская выгрузка разбирается тем же кодом', () => {
  const { terms, totals, meta } = parseSearchTermsCsv(fixture('search-terms-en.csv'));

  assert.equal(terms.length, 4);
  assert.equal(totals.length, 2, 'строки «Total:» тоже служебные');
  assert.equal(meta.hasCampaignColumn, true);

  const wholesale = terms.find((term) => term.searchTerm === 'wholesale flowers');
  assert.equal(wholesale.cost, 5000, 'запятая как разделитель тысяч в английской локали');
  assert.equal(terms.find((term) => term.searchTerm === 'roses pmax').campaignType, 'pmax');
});

test('выгрузка без колонки «Кампания» разбирается без ошибки', () => {
  const withoutCampaign = [
    'Поисковый запрос,Тип соответствия,Добавленные/Исключенные,Kлики,Показы,CTR,Код валюты,Ср. цена за клик,Расходы,Тип кампании,Коэфф. конверсии,Конверсии,Стоимость/конв.',
    'tulip bouquet near me,Максимальная эффективность,Не используется,0,1,"0,00%",USD,0,"0,00",Максимальная эффективность,"0,00%","0,00","0,00"',
  ].join('\r\n');

  const { terms, meta } = parseSearchTermsCsv(withoutCampaign);
  assert.equal(meta.hasCampaignColumn, false);
  assert.equal(meta.headerRowIndex, 0);
  assert.equal(terms[0].campaign, '');
});

test('findHiddenTermsTotal находит агрегат скрытых запросов', () => {
  const { totals } = parseSearchTermsCsv(fixture('search-terms-ru.csv'));
  const hidden = findHiddenTermsTotal(totals);
  assert.equal(hidden.cost, 40);
});

test('нераспознанный формат даёт понятную ошибку, а не падение', () => {
  assert.throws(
    () => parseSearchTermsCsv('колонка A,колонка B\n1,2'),
    /Не найдена строка заголовков/,
  );
  assert.throws(() => parseSearchTermsCsv(''), /Файл пуст/);
});

test('предел числа строк соблюдается', () => {
  assert.throws(
    () => parseSearchTermsCsv(fixture('search-terms-ru.csv'), { maxRows: 5 }),
    /больше допустимого предела/,
  );
});
