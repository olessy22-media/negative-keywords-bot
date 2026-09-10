/**
 * Хранение профилей проектов и состояния диалога в Redis.
 * Все ключи привязаны к chat_id: чужой чат не видит чужие проекты.
 */

import { getRedis } from '../store/redis.js';
import { normalizeProfile } from './profile.js';

const MAX_PROFILES_PER_CHAT = 50;

const keys = {
  profile: (chatId, slug) => `profile:${chatId}:${slug}`,
  profileIndex: (chatId) => `profiles:${chatId}`,
  selected: (chatId) => `selected:${chatId}`,
  dialog: (chatId) => `dialog:${chatId}`,
  update: (updateId) => `update:${updateId}`,
};

/**
 * Отмечает update как обработанный.
 * Vercel завершает функцию только после ответа, поэтому долгий разбор может
 * не уложиться в таймаут Telegram и тот пришлёт update повторно. Дедуп
 * гарантирует, что файл не будет разобран дважды.
 * @returns {Promise<boolean>} true, если update видим впервые
 */
export async function markUpdateSeen(config, updateId) {
  const redis = getRedis(config.redis);
  const stored = await redis.set(keys.update(updateId), 1, {
    nx: true,
    ex: config.limits.updateDedupeTtlSeconds,
  });
  return stored === 'OK';
}

/** @returns {Promise<string[]>} slug'и проектов чата */
export async function listProfileSlugs(config, chatId) {
  const redis = getRedis(config.redis);
  const slugs = await redis.smembers(keys.profileIndex(chatId));
  return (slugs ?? []).map(String).sort();
}

/** @returns {Promise<object|null>} профиль или null */
export async function getProfile(config, chatId, slug) {
  const redis = getRedis(config.redis);
  const raw = await redis.get(keys.profile(chatId, slug));
  return raw ? normalizeProfile(raw) : null;
}

/**
 * @returns {Promise<object>} сохранённый профиль
 * @throws {Error} если достигнут предел числа проектов
 */
export async function saveProfile(config, chatId, profile) {
  const redis = getRedis(config.redis);
  const normalized = normalizeProfile(profile);
  const slugs = await listProfileSlugs(config, chatId);

  if (!slugs.includes(normalized.slug) && slugs.length >= MAX_PROFILES_PER_CHAT) {
    throw new Error(`Достигнут предел в ${MAX_PROFILES_PER_CHAT} проектов. Удалите ненужные.`);
  }

  await redis.set(keys.profile(chatId, normalized.slug), normalized);
  await redis.sadd(keys.profileIndex(chatId), normalized.slug);
  return normalized;
}

/** Удаляет профиль вместе со ссылкой на него в выборе по умолчанию. */
export async function deleteProfile(config, chatId, slug) {
  const redis = getRedis(config.redis);
  await redis.del(keys.profile(chatId, slug));
  await redis.srem(keys.profileIndex(chatId), slug);
  if ((await getSelectedSlug(config, chatId)) === slug) {
    await redis.del(keys.selected(chatId));
  }
}

/** @returns {Promise<string>} slug выбранного проекта или пустая строка */
export async function getSelectedSlug(config, chatId) {
  const redis = getRedis(config.redis);
  const slug = await redis.get(keys.selected(chatId));
  return slug ? String(slug) : '';
}

export async function setSelectedSlug(config, chatId, slug) {
  const redis = getRedis(config.redis);
  await redis.set(keys.selected(chatId), slug);
}

/** @returns {Promise<object|null>} состояние диалога /newproject */
export async function getDialog(config, chatId) {
  const redis = getRedis(config.redis);
  return (await redis.get(keys.dialog(chatId))) ?? null;
}

/** Состояние диалога живёт с TTL: брошенный на полпути диалог не залипает. */
export async function setDialog(config, chatId, state) {
  const redis = getRedis(config.redis);
  await redis.set(keys.dialog(chatId), state, { ex: config.limits.dialogTtlSeconds });
}

export async function clearDialog(config, chatId) {
  const redis = getRedis(config.redis);
  await redis.del(keys.dialog(chatId));
}
