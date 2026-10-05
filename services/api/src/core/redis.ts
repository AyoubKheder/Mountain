import { Redis as RedisClient } from 'ioredis';

let client: RedisClient | null = null;

export function getRedis(url = process.env.REDIS_URL ?? 'redis://localhost:6379'): RedisClient {
  if (!client) {
    client = new RedisClient(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
    });
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
