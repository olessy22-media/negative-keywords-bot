/**
 * Чтение .env для локальных скриптов.
 *
 * Боту это не нужно: на Vercel переменные приходят от платформы. Нужно здесь,
 * чтобы не прокидывать секреты через аргументы командной строки — оттуда они
 * попадают в историю shell и в список процессов.
 */

import { existsSync, readFileSync } from 'node:fs';

const LINE_RE = /^([A-Z][A-Z0-9_]*)=(.*)$/;

/**
 * Разбирает файл в пары «имя — значение». Пустые значения пропускаются:
 * незаполненная переменная это то же самое, что её отсутствие.
 * @param {string} [path]
 * @returns {Map<string, string>}
 */
export function parseEnvFile(path = '.env') {
  const variables = new Map();
  if (!existsSync(path)) return variables;

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(LINE_RE);
    if (!match) continue;

    const value = match[2].trim().replace(/^["']|["']$/g, '');
    if (value) variables.set(match[1], value);
  }
  return variables;
}

/**
 * Загружает переменные в process.env, не перезаписывая уже заданные.
 * @param {string} [path]
 * @returns {number} сколько переменных загружено
 */
export function loadEnvFile(path = '.env') {
  let loaded = 0;
  for (const [name, value] of parseEnvFile(path)) {
    if (process.env[name]) continue;
    process.env[name] = value;
    loaded += 1;
  }
  return loaded;
}
