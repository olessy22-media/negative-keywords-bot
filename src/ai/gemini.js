/**
 * Провайдер смыслового слоя: Gemini через Google AI Studio.
 * Весь код, специфичный для провайдера, находится только здесь —
 * смена модели или вендора это правка одного файла.
 */

import { GoogleGenAI } from '@google/genai';
import { RESPONSE_SCHEMA, SYSTEM_INSTRUCTION, buildUserPrompt } from './prompt.js';

/**
 * Классифицирует один пакет запросов.
 * @param {string[]} terms тексты запросов
 * @param {object} profile профиль проекта
 * @param {{apiKey: string, model: string, timeoutMs: number}} options
 * @returns {Promise<object[]>} массив вердиктов
 * @throws {Error} если модель недоступна или вернула неразбираемый ответ
 */
export async function classifyBatch(terms, profile, options) {
  const client = new GoogleGenAI({ apiKey: options.apiKey });

  const response = await client.models.generateContent({
    model: options.model,
    contents: buildUserPrompt(terms, profile),
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      abortSignal: AbortSignal.timeout(options.timeoutMs),
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error('Модель вернула пустой ответ');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error('Модель вернула не-JSON', { cause });
  }

  if (!Array.isArray(parsed?.results)) {
    throw new Error('В ответе модели нет массива results');
  }

  return parsed.results;
}
