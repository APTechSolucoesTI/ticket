import type { INestApplication } from '@nestjs/common';
import type { RedisIoAdapter } from '../channels/chat/redis-io.adapter';
import { REDIS_SHUTDOWN_TIMEOUT_MS } from '../queue/redis-lifecycle';

/** Failed startup gets bounded best-effort cleanup; normal signals drain Nest workers. */
export async function startApplication(
  app: INestApplication,
  adapter: RedisIoAdapter,
  port: number,
): Promise<void> {
  try {
    app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
    app.useWebSocketAdapter(adapter);
    await adapter.connectToRedis();
    await app.listen(port);
  } catch {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled([
          Promise.resolve().then(() => adapter.dispose()),
          Promise.resolve().then(() => app.close()),
        ]),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, REDIS_SHUTDOWN_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    throw new Error('api_startup_failed');
  }
}
