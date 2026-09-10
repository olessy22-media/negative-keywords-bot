import assert from 'node:assert/strict';
import test from 'node:test';

import handler from '../api/telegram.js';
import { extractChatId } from '../src/telegram/router.js';
import { resetConfigCache } from '../src/config.js';

const REQUIRED_ENV = {
  TELEGRAM_BOT_TOKEN: 'test-token',
  TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
  ALLOWED_CHAT_IDS: '111,222',
  UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'test-redis-token',
};

function withEnv(values) {
  const saved = { ...process.env };
  for (const key of Object.keys(REQUIRED_ENV)) delete process.env[key];
  Object.assign(process.env, values);
  resetConfigCache();
  return () => {
    process.env = saved;
    resetConfigCache();
  };
}

function fakeResponse() {
  return {
    statusCode: 0,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

function fakeRequest({ method = 'POST', secret = '', body = {} } = {}) {
  return {
    method,
    headers: secret ? { 'x-telegram-bot-api-secret-token': secret } : {},
    body,
  };
}

test('запрос не POST отклоняется', async () => {
  const restore = withEnv(REQUIRED_ENV);
  const response = fakeResponse();
  await handler(fakeRequest({ method: 'GET' }), response);
  assert.equal(response.statusCode, 405);
  restore();
});

test('без секретного токена вебхука запрос не обрабатывается', async () => {
  const restore = withEnv(REQUIRED_ENV);
  const response = fakeResponse();
  await handler(fakeRequest({ body: { update_id: 1 } }), response);
  assert.equal(response.statusCode, 401);
  restore();
});

test('неверный секретный токен вебхука отклоняется', async () => {
  const restore = withEnv(REQUIRED_ENV);
  const response = fakeResponse();
  await handler(fakeRequest({ secret: 'wrong-secret', body: { update_id: 1 } }), response);
  assert.equal(response.statusCode, 401);
  restore();
});

test('при нехватке переменных окружения вебхук падает громко', async () => {
  const restore = withEnv({ TELEGRAM_BOT_TOKEN: 'test-token' });
  const response = fakeResponse();
  await handler(fakeRequest({ secret: 'test-webhook-secret' }), response);
  assert.equal(response.statusCode, 500);
  restore();
});

test('пустой белый список chat_id не принимается', async () => {
  const restore = withEnv({ ...REQUIRED_ENV, ALLOWED_CHAT_IDS: ' , ' });
  const response = fakeResponse();
  await handler(fakeRequest({ secret: 'test-webhook-secret' }), response);
  assert.equal(response.statusCode, 500);
  restore();
});

test('chat_id достаётся из сообщений, правок и нажатий кнопок', () => {
  assert.equal(extractChatId({ message: { chat: { id: 42 } } }), '42');
  assert.equal(extractChatId({ edited_message: { chat: { id: 43 } } }), '43');
  assert.equal(extractChatId({ callback_query: { message: { chat: { id: 44 } } } }), '44');
  assert.equal(extractChatId({ channel_post: { chat: { id: 45 } } }), '');
  assert.equal(extractChatId({}), '');
});
