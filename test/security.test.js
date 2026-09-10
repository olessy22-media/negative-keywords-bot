import assert from 'node:assert/strict';
import test from 'node:test';

import { UserFacingError, safeErrorText } from '../src/errors.js';
import { downloadFile } from '../src/telegram/api.js';
import { parseCsvSafely } from '../src/telegram/handlers/document.js';
import { toSlug } from '../src/profiles/profile.js';

test('ошибка разбора файла не выносит наружу содержимое клиента', () => {
  const secretRow = 'super-secret-client-term';
  const broken = `Поисковый запрос,Добавленные/Исключенные,Расходы,Тип кампании,Конверсии\n"${secretRow}`;

  assert.throws(
    () => parseCsvSafely(broken, 20000),
    (error) => {
      assert.ok(error instanceof UserFacingError, 'ошибка помечена как безопасная');
      assert.ok(!error.message.includes(secretRow), 'текст запроса не попал в сообщение');
      return true;
    },
  );
});

test('понятные ошибки формата доходят до пользователя как есть', () => {
  assert.throws(() => parseCsvSafely('колонка A,колонка B\n1,2', 20000), /Не найдена строка заголовков/);
  assert.throws(() => parseCsvSafely('', 20000), /Файл пуст/);
});

test('в лог уходит только наш текст, чужие ошибки обезличиваются', () => {
  assert.equal(safeErrorText(new UserFacingError('Файл пуст')), 'Файл пуст');
  assert.equal(
    safeErrorText(new TypeError('нельзя прочитать поле super-secret-client-term')),
    'внутренняя ошибка (TypeError)',
  );
});

test('подозрительный путь к файлу не подставляется в URL', async () => {
  for (const path of ['../../etc/passwd', 'documents/../../x', 'файл.csv', 'a'.repeat(300)]) {
    await assert.rejects(
      () => downloadFile('test-token', path, 1024),
      /неожиданный путь к файлу/,
      `путь «${path.slice(0, 20)}» должен быть отклонён`,
    );
  }
});

test('slug не может унести путь в ключ хранилища', () => {
  for (const name of ['../../etc/passwd', 'profile:*', 'a b/c\\d', '<script>']) {
    assert.match(toSlug(name), /^[a-z0-9-]{1,40}$/, `slug из «${name}» должен быть безопасным`);
  }
});
