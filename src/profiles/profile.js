/**
 * Профиль проекта: четыре поля, которые настраиваются один раз на клиента.
 * Поле notDoing («чего НЕ делаем») — главный источник точности смыслового слоя.
 */

const MAX_FIELD_LENGTH = 500;
const MAX_LIST_ITEMS = 30;

/** Вопросы диалога /newproject в порядке задавания. */
export const PROFILE_QUESTIONS = [
  {
    field: 'name',
    text: '1/5. Как назовём проект? Короткое имя для списка, например «Цветы, поиск US».',
  },
  {
    field: 'sells',
    text: '2/5. Что продаём? Коротко: услуги или товары, на английском — так их видит модель.',
  },
  {
    field: 'notDoing',
    text:
      '3/5. Чего НЕ делаем? Самое важное поле. Например: «не работаем с физлицами», ' +
      '«не продаём б/у», «только на заказ».',
  },
  {
    field: 'geo',
    text: '4/5. География работы — города и штаты через запятую. Например: «Springfield, MO, Branson, MO».',
  },
  {
    field: 'brands',
    text:
      '5/5. Бренды через запятую: сначала свой, затем конкуренты. ' +
      'Например: «Bloomline, FTD, Teleflora». Если своего бренда в запросах нет — поставьте прочерк первым.',
  },
];

function trimField(value) {
  return String(value ?? '').trim().slice(0, MAX_FIELD_LENGTH);
}

function toList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => trimField(item)).filter(Boolean).slice(0, MAX_LIST_ITEMS);
  }
  return trimField(value)
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item && item !== '-' && item !== '—')
    .slice(0, MAX_LIST_ITEMS);
}

/**
 * Приводит профиль к предсказуемой форме. Данные приходят из диалога и из
 * Redis, поэтому проверяются на границе, а не в местах использования.
 * @param {object} raw
 * @returns {object}
 */
export function normalizeProfile(raw) {
  const brands = toList(raw?.brands ?? []);
  return {
    slug: trimField(raw?.slug),
    name: trimField(raw?.name) || 'Без названия',
    sells: trimField(raw?.sells),
    notDoing: trimField(raw?.notDoing),
    geo: toList(raw?.geo),
    ownBrand: trimField(raw?.ownBrand ?? brands[0] ?? ''),
    competitors: raw?.competitors ? toList(raw.competitors) : brands.slice(1),
    createdAt: trimField(raw?.createdAt) || new Date().toISOString(),
  };
}

/**
 * Превращает slug в безопасный ключ Redis: только латиница, цифры и дефис.
 * Без этого имя проекта от пользователя попадёт в ключ хранилища как есть.
 * @param {string} name
 * @returns {string}
 */
export function toSlug(name) {
  const translit = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
    и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };

  const slug = [...String(name ?? '').toLowerCase()]
    .map((char) => translit[char] ?? char)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  return slug || `project-${Date.now().toString(36)}`;
}
