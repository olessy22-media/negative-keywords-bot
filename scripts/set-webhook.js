#!/usr/bin/env node
/**
 * Установка вебхука Telegram с секретным токеном.
 *
 * Использование:
 *   node scripts/set-webhook.js https://<проект>.vercel.app/api/telegram
 *   node scripts/set-webhook.js --info
 *   node scripts/set-webhook.js --delete
 *
 * Токен и секрет берутся из .env (или из окружения) и на экран не выводятся.
 */

import process from 'node:process';

import { loadEnvFile } from './load-env-file.js';

loadEnvFile();

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!token || !secret) {
  console.error('Нужны TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET — заполните .env по образцу .env.example.');
  process.exit(1);
}

async function callApi(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });
  const data = await response.json();
  if (!data.ok) throw new Error(`${method}: ${data.description}`);
  return data.result;
}

const argument = process.argv[2];

if (argument === '--info') {
  const info = await callApi('getWebhookInfo');
  console.log(
    JSON.stringify(
      { ...info, url: info.url ? info.url.replace(/\/\/[^/]+/, '//<host>') : '' },
      null,
      2,
    ),
  );
} else if (argument === '--delete') {
  await callApi('deleteWebhook', { drop_pending_updates: true });
  console.log('Вебхук удалён.');
} else if (argument?.startsWith('https://')) {
  await callApi('setWebhook', {
    url: argument,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
  console.log('Вебхук установлен. Проверка: node scripts/set-webhook.js --info');
} else {
  console.error('Укажите https-адрес вебхука, --info или --delete.');
  process.exit(1);
}
