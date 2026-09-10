/**
 * Конфигурация приложения. Единственное место, где читается process.env.
 * Все значения, которые могут меняться, приходят из окружения, а не из кода.
 */

const REQUIRED_VARS = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'ALLOWED_CHAT_IDS',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
];

const DEFAULTS = {
  GEMINI_MODEL: 'gemini-3.5-flash-lite',
  MAX_TERMS_TO_AI: 200,
  MIN_SPEND_FOR_MONEY_FLAG: 1,
  AI_BATCH_SIZE: 100,
  AI_TIMEOUT_MS: 45000,
  MAX_FILE_BYTES: 10 * 1024 * 1024,
  MAX_CSV_ROWS: 20000,
  DIALOG_TTL_SECONDS: 900,
  UPDATE_DEDUPE_TTL_SECONDS: 3600,
};

/** Число из окружения с понятной ошибкой вместо тихого NaN. */
function readNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Переменная окружения ${name} должна быть числом, получено: ${raw}`);
  }
  return value;
}

function parseChatIds(raw) {
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

let cached = null;

/**
 * Собирает и проверяет конфигурацию. Fail-fast: при нехватке обязательной
 * переменной бросает ошибку со списком всего, чего не хватает.
 * @returns {object} готовая конфигурация
 */
export function loadConfig() {
  if (cached) return cached;

  const missing = REQUIRED_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Не заданы обязательные переменные окружения: ${missing.join(', ')}. ` +
        'Заполните .env по образцу .env.example (локально) или добавьте их в переменные окружения Vercel.',
    );
  }

  const allowedChatIds = parseChatIds(process.env.ALLOWED_CHAT_IDS);
  if (allowedChatIds.length === 0) {
    throw new Error('ALLOWED_CHAT_IDS задан, но пуст: белый список не может быть пустым.');
  }

  cached = {
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
      allowedChatIds,
    },
    redis: {
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    },
    ai: {
      // Ключа может не быть: бот обязан работать и без смыслового слоя.
      apiKey: process.env.GEMINI_API_KEY || '',
      model: process.env.GEMINI_MODEL || DEFAULTS.GEMINI_MODEL,
      maxTermsToAi: readNumber('MAX_TERMS_TO_AI', DEFAULTS.MAX_TERMS_TO_AI),
      batchSize: readNumber('AI_BATCH_SIZE', DEFAULTS.AI_BATCH_SIZE),
      timeoutMs: readNumber('AI_TIMEOUT_MS', DEFAULTS.AI_TIMEOUT_MS),
    },
    analysis: {
      minSpendForMoneyFlag: readNumber('MIN_SPEND_FOR_MONEY_FLAG', DEFAULTS.MIN_SPEND_FOR_MONEY_FLAG),
    },
    limits: {
      maxFileBytes: readNumber('MAX_FILE_BYTES', DEFAULTS.MAX_FILE_BYTES),
      maxCsvRows: readNumber('MAX_CSV_ROWS', DEFAULTS.MAX_CSV_ROWS),
      dialogTtlSeconds: readNumber('DIALOG_TTL_SECONDS', DEFAULTS.DIALOG_TTL_SECONDS),
      updateDedupeTtlSeconds: readNumber('UPDATE_DEDUPE_TTL_SECONDS', DEFAULTS.UPDATE_DEDUPE_TTL_SECONDS),
    },
  };

  return cached;
}

/** Сбрасывает кеш конфигурации. Нужен только тестам. */
export function resetConfigCache() {
  cached = null;
}
