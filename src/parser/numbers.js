/**
 * Разбор чисел из выгрузки Google Ads.
 *
 * В русской локали десятичный разделитель — запятая, разделитель тысяч —
 * неразрывный пробел: «1 266», «"715,71"», «"6,16%"». В английской локали
 * наоборот. Функция определяет разделитель по позиции, а не по локали.
 */

const CLEANUP_RE = /[\s   ​]/g;
const KEEP_RE = /[^\d.,-]/g;
const THOUSANDS_GROUPS_RE = /^-?\d{1,3}([.,]\d{3})+$/;

/**
 * @param {string|number|null|undefined} raw значение ячейки
 * @returns {number} число; для пустых и нечисловых значений — 0
 */
export function parseNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;

  const cleaned = String(raw ?? '')
    .replace(CLEANUP_RE, '')
    .replace(KEEP_RE, '');

  if (cleaned === '' || cleaned === '-') return 0;

  const lastSeparatorIndex = Math.max(cleaned.lastIndexOf(','), cleaned.lastIndexOf('.'));
  if (lastSeparatorIndex === -1) {
    const value = Number(cleaned);
    return Number.isFinite(value) ? value : 0;
  }

  const decimalsCount = cleaned.length - lastSeparatorIndex - 1;
  // Три знака после разделителя при группировке по три — это тысячи, а не дробь.
  if (decimalsCount === 3 && THOUSANDS_GROUPS_RE.test(cleaned)) {
    const value = Number(cleaned.replace(/[.,]/g, ''));
    return Number.isFinite(value) ? value : 0;
  }

  const integerPart = cleaned.slice(0, lastSeparatorIndex).replace(/[.,]/g, '');
  const fractionPart = cleaned.slice(lastSeparatorIndex + 1);
  const value = Number(`${integerPart || '0'}.${fractionPart || '0'}`);
  return Number.isFinite(value) ? value : 0;
}

/** Округляет деньги до двух знаков, убирая накопленную ошибку сложения. */
export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/** Формат для отчёта: «715.71». */
export function formatMoney(value) {
  return roundMoney(value).toFixed(2);
}
