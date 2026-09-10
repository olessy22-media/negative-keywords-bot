/**
 * Ошибки, текст которых написали мы сами и который безопасно показать
 * пользователю и записать в лог.
 *
 * Всё остальное — ошибки библиотек и внешних сервисов: их сообщения могут
 * содержать куски разбираемого файла, то есть данные клиента. Такие сообщения
 * в лог не попадают, наружу уходит только тип ошибки.
 */
export class UserFacingError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'UserFacingError';
  }
}

/**
 * @param {unknown} error
 * @returns {string} текст, который можно записать в лог и показать владельцу
 */
export function safeErrorText(error) {
  if (error instanceof UserFacingError) return error.message;
  return `внутренняя ошибка (${error?.name ?? 'Error'})`;
}
