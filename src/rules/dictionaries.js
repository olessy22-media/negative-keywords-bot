/**
 * Загрузка словарей из config/. Словари — данные, а не код: пополняются
 * правкой JSON без изменения логики.
 */

import { createRequire } from 'node:module';

const loadJson = createRequire(import.meta.url);

export const stopwordsDictionary = loadJson('../../config/stopwords.en.json');
export const geoReference = loadJson('../../config/geo-us.json');
