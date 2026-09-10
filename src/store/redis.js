/**
 * Клиент Upstash Redis. Профили проектов лежат в облаке, а не в репозитории:
 * это требование конфиденциальности, а не удобства.
 */

import { Redis } from '@upstash/redis';

let client = null;

/**
 * @param {{url: string, token: string}} redisConfig
 * @returns {Redis}
 */
export function getRedis(redisConfig) {
  if (!client) {
    client = new Redis({ url: redisConfig.url, token: redisConfig.token });
  }
  return client;
}
