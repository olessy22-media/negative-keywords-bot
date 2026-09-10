#!/usr/bin/env node
/**
 * Переносит переменные из .env в проект Vercel.
 *
 * Значения идут из файла прямо в CLI и нигде больше не появляются — ни на
 * экране, ни в истории команд. Показывается только имя переменной и результат.
 *
 * Использование: node scripts/push-env.js [production|preview|development]
 */

import { spawnSync } from 'node:child_process';
import process from 'node:process';

import { parseEnvFile } from './load-env-file.js';

const TARGET = process.argv[2] ?? 'production';
const VALID_TARGETS = ['production', 'preview', 'development'];

if (!VALID_TARGETS.includes(TARGET)) {
  console.error(`Окружение должно быть одним из: ${VALID_TARGETS.join(', ')}`);
  process.exit(1);
}

const variables = parseEnvFile('.env');
if (variables.size === 0) {
  console.error('В .env нет заполненных переменных.');
  process.exit(1);
}

console.log(`Переношу ${variables.size} переменных в окружение ${TARGET}.\n`);

let failed = 0;
for (const [name, value] of variables) {
  spawnSync('npx', ['vercel', 'env', 'rm', name, TARGET, '--yes'], { stdio: 'ignore' });
  const result = spawnSync('npx', ['vercel', 'env', 'add', name, TARGET], {
    input: value,
    stdio: ['pipe', 'ignore', 'pipe'],
    encoding: 'utf8',
  });

  const ok = result.status === 0;
  if (!ok) failed += 1;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${String(result.stderr).trim().split('\n').pop()}`}`);
}

console.log(failed === 0 ? '\nГотово.' : `\nНе перенесено: ${failed}.`);
process.exit(failed === 0 ? 0 : 1);
