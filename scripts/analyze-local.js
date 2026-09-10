#!/usr/bin/env node
/**
 * Локальный прогон разбора без Telegram и Redis.
 * Нужен, чтобы проверять логику на файле, не отправляя его никуда:
 * реальные выгрузки клиентов остаются на диске владельца.
 *
 * Использование:
 *   node scripts/analyze-local.js <файл.csv> [профиль.json] [--out каталог]
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import process from 'node:process';

import { analyzeSearchTerms } from '../src/analysis/analyze.js';
import { loadAnalysisConfig } from '../src/config.js';
import { normalizeProfile } from '../src/profiles/profile.js';
import { parseSearchTermsCsv } from '../src/parser/searchTerms.js';
import {
  formatNegativeKeywordsFile,
  formatReviewFile,
  formatSummary,
} from '../src/report/format.js';

function parseArgs(argv) {
  const positional = [];
  let outDir = '';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') {
      outDir = argv[i + 1] ?? '';
      i += 1;
    } else {
      positional.push(argv[i]);
    }
  }
  return { csvPath: positional[0], profilePath: positional[1], outDir };
}

const { csvPath, profilePath, outDir } = parseArgs(process.argv.slice(2));

if (!csvPath) {
  console.error('Укажите путь к CSV: node scripts/analyze-local.js <файл.csv> [профиль.json]');
  process.exit(1);
}

const config = loadAnalysisConfig();
const profile = normalizeProfile(
  JSON.parse(readFileSync(profilePath ?? 'sample/demo-profile.json', 'utf8')),
);

const parsed = parseSearchTermsCsv(readFileSync(csvPath), { maxRows: config.limits.maxCsvRows });
const report = await analyzeSearchTerms(parsed, profile, config);

const negativesFile = formatNegativeKeywordsFile(report, profile);
const reviewFile = formatReviewFile(report, profile);

console.log(formatSummary(report, profile).replace(/<\/?b>/g, ''));

if (outDir) {
  mkdirSync(outDir, { recursive: true });
  const stem = basename(csvPath).replace(/\.csv$/i, '');
  writeFileSync(join(outDir, `${stem}-negatives.txt`), negativesFile);
  writeFileSync(join(outDir, `${stem}-review.txt`), reviewFile);
  console.log(`\nФайлы записаны в ${outDir}`);
}
