/**
 * Команды бота и диалог создания проекта.
 * Интерфейс русский; словари мусора и тексты профиля — английские.
 */

import { PROFILE_QUESTIONS, normalizeProfile, toSlug } from '../../profiles/profile.js';
import {
  clearDialog,
  deleteProfile,
  getDialog,
  getProfile,
  listProfileSlugs,
  saveProfile,
  setDialog,
  setSelectedSlug,
} from '../../profiles/store.js';
import { answerCallbackQuery, sendMessage } from '../api.js';
import { escapeHtml } from '../../report/format.js';

const HELP_TEXT = [
  '<b>Минусовка поисковых запросов Google Ads</b>',
  '',
  'Пришлите CSV отчёта «Поисковые запросы» — верну готовые минус-слова по кампаниям,',
  'список сомнительных запросов и отдельный список тех, что минусовать нельзя.',
  '',
  '<b>Как выгрузить отчёт</b>',
  'Google Ads → Кампании → Аналитика → Поисковые запросы → Скачать → CSV',
  '(именно CSV, не «Excel CSV»).',
  '',
  '<b>Команды</b>',
  '/projects — список проектов и выбор активного',
  '/newproject [имя] — создать профиль проекта',
  '/deleteproject — удалить профиль',
  '/cancel — прервать диалог',
  '/help — эта справка',
  '',
  'Профиль проекта нужен, чтобы бот понимал, что для вас мусор.',
  'Бот ничего не меняет в рекламном кабинете — только предлагает.',
].join('\n');

function profileKeyboard(slugs, prefix) {
  return {
    inline_keyboard: slugs.map((slug) => [{ text: slug, callback_data: `${prefix}:${slug}` }]),
  };
}

async function describeProjects(config, chatId, token, prefix, emptyText) {
  const slugs = await listProfileSlugs(config, chatId);
  if (slugs.length === 0) {
    await sendMessage(token, chatId, emptyText);
    return;
  }
  await sendMessage(token, chatId, 'Выберите проект:', {
    reply_markup: profileKeyboard(slugs, prefix),
  });
}

async function askQuestion(config, chatId, token, state) {
  await setDialog(config, chatId, state);
  await sendMessage(token, chatId, PROFILE_QUESTIONS[state.step].text);
}

async function finishDialog(config, chatId, token, state) {
  const name = state.name || state.answers.sells || 'Проект';
  const profile = normalizeProfile({
    ...state.answers,
    name,
    slug: toSlug(name),
  });

  await saveProfile(config, chatId, profile);
  await setSelectedSlug(config, chatId, profile.slug);
  await clearDialog(config, chatId);

  await sendMessage(
    token,
    chatId,
    [
      `✅ Профиль «${escapeHtml(profile.name)}» сохранён и выбран активным.`,
      '',
      `Что продаём: ${escapeHtml(profile.sells) || '—'}`,
      `Чего НЕ делаем: ${escapeHtml(profile.notDoing) || '—'}`,
      `Гео: ${escapeHtml(profile.geo.join(', ')) || 'не задано'}`,
      `Свой бренд: ${escapeHtml(profile.ownBrand) || 'не задан'}`,
      `Конкуренты: ${escapeHtml(profile.competitors.join(', ')) || 'не заданы'}`,
      '',
      'Присылайте CSV отчёта «Поисковые запросы».',
    ].join('\n'),
  );
}

/**
 * Обрабатывает очередной ответ в диалоге /newproject.
 * @returns {Promise<boolean>} true, если сообщение было ответом на вопрос диалога
 */
export async function handleDialogAnswer(config, chatId, token, text) {
  const state = await getDialog(config, chatId);
  if (!state) return false;

  const question = PROFILE_QUESTIONS[state.step];
  const nextState = {
    ...state,
    step: state.step + 1,
    answers: { ...state.answers, [question.field]: text },
  };

  if (nextState.step >= PROFILE_QUESTIONS.length) {
    await finishDialog(config, chatId, token, nextState);
  } else {
    await askQuestion(config, chatId, token, nextState);
  }
  return true;
}

/**
 * Обрабатывает команду.
 * @returns {Promise<boolean>} true, если команда распознана
 */
export async function handleCommand(config, chatId, token, text) {
  const [rawCommand, ...rest] = text.trim().split(/\s+/);
  const command = rawCommand.split('@')[0].toLowerCase();
  const argument = rest.join(' ');

  switch (command) {
    case '/start':
    case '/help':
      await sendMessage(token, chatId, HELP_TEXT);
      return true;

    case '/cancel':
      await clearDialog(config, chatId);
      await sendMessage(token, chatId, 'Диалог прерван.');
      return true;

    case '/projects':
      await describeProjects(
        config,
        chatId,
        token,
        'sel',
        'Проектов пока нет. Создайте первый: /newproject Имя проекта',
      );
      return true;

    case '/deleteproject':
      await describeProjects(config, chatId, token, 'del', 'Удалять нечего: проектов нет.');
      return true;

    case '/newproject':
      await askQuestion(config, chatId, token, { step: 0, name: argument, answers: {} });
      return true;

    default:
      return false;
  }
}

/**
 * Обрабатывает нажатие кнопки под сообщением.
 * @returns {Promise<void>}
 */
export async function handleCallback(config, chatId, token, callbackQuery) {
  const [action, slug] = String(callbackQuery.data ?? '').split(':');

  if (action === 'sel') {
    const profile = await getProfile(config, chatId, slug);
    if (!profile) {
      await answerCallbackQuery(token, callbackQuery.id, 'Проект не найден');
      return;
    }
    await setSelectedSlug(config, chatId, slug);
    await answerCallbackQuery(token, callbackQuery.id, 'Выбрано');
    await sendMessage(token, chatId, `Активный проект: <b>${escapeHtml(profile.name)}</b>`);
    return;
  }

  if (action === 'del') {
    await deleteProfile(config, chatId, slug);
    await answerCallbackQuery(token, callbackQuery.id, 'Удалено');
    await sendMessage(token, chatId, `Профиль <b>${escapeHtml(slug)}</b> удалён.`);
    return;
  }

  await answerCallbackQuery(token, callbackQuery.id);
}
