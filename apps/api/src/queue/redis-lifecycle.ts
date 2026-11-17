import type Redis from 'ioredis';

export const REDIS_STARTUP_TIMEOUT_MS = 5000;
export const REDIS_SHUTDOWN_TIMEOUT_MS = 2000;

export function disconnectRedis(client: Pick<Redis, 'disconnect'>): void {
  try {
    client.disconnect();
  } catch {
    /* Continue releasing other owned clients. */
  }
}

/** QUIT is graceful only while connected; never enqueue it offline indefinitely. */
export async function closeRedis(
  client: Pick<Redis, 'status' | 'quit' | 'disconnect'>,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (client.status === 'ready')
      await Promise.race([
        client.quit().then(
          () => undefined,
          () => undefined,
        ),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, REDIS_SHUTDOWN_TIMEOUT_MS);
        }),
      ]);
  } catch {
    /* Cleanup failures must not stop the remaining shutdown hooks. */
  } finally {
    if (timer) clearTimeout(timer);
    disconnectRedis(client);
  }
}
