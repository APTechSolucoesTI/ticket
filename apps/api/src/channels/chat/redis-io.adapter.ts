import { IoAdapter } from '@nestjs/platform-socket.io';
import { Logger, type INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import type { Env } from '../../config/env.validation';
import {
  disconnectRedis,
  REDIS_STARTUP_TIMEOUT_MS,
} from '../../queue/redis-lifecycle';

type SocketIoAdapterFn = ReturnType<typeof createAdapter>;

// Sem isso, duas instâncias da API atrás de um load balancer não conseguem
// entregar mensagem de uma sessão conectada na instância A pra uma sessão
// conectada na instância B - o Redis Pub/Sub é quem faz essa ponte. Exigido
// explicitamente pelo prompt como validação de que o WhatsApp/chat
// escalam horizontalmente de verdade.
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: SocketIoAdapterFn;
  private readonly logger = new Logger(RedisIoAdapter.name);
  private clients: Redis[] = [];
  private connecting: Promise<void> | undefined;
  private abort: AbortController | undefined;
  private disposed = false;

  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  connectToRedis(): Promise<void> {
    if (this.disposed)
      return Promise.reject(new Error('chat_redis_adapter_disposed'));
    if (this.adapterConstructor) return Promise.resolve();
    if (this.connecting) return this.connecting;
    const tracked = this.open().finally(() => {
      if (this.connecting === tracked) this.connecting = undefined;
    });
    this.connecting = tracked;
    return tracked;
  }

  private async open(): Promise<void> {
    const controller = new AbortController();
    this.abort = controller;
    const timer = setTimeout(
      () => controller.abort(),
      REDIS_STARTUP_TIMEOUT_MS,
    );
    let removeAbort = () => {};
    try {
      const config = this.app.get(ConfigService<Env, true>);
      const url = config.get('REDIS_URL', { infer: true });
      const pubClient = new Redis(url, {
        lazyConnect: true,
        connectTimeout: REDIS_STARTUP_TIMEOUT_MS,
        disconnectTimeout: 0,
      });
      this.clients.push(pubClient);
      this.observe(pubClient);
      const subClient = pubClient.duplicate();
      this.clients.push(subClient);
      this.observe(subClient);
      await new Promise<void>((resolve, reject) => {
        const fail = () => reject(new Error('chat_redis_startup_failed'));
        controller.signal.addEventListener('abort', fail, { once: true });
        removeAbort = () =>
          controller.signal.removeEventListener('abort', fail);
        void Promise.all([pubClient.connect(), subClient.connect()]).then(
          () => resolve(),
          fail,
        );
      });
      if (this.disposed || controller.signal.aborted)
        throw new Error('chat_redis_startup_failed');
      this.adapterConstructor = createAdapter(pubClient, subClient);
    } catch {
      this.releaseClients();
      throw new Error('chat_redis_startup_failed');
    } finally {
      clearTimeout(timer);
      removeAbort();
      if (this.abort === controller) this.abort = undefined;
    }
  }

  private observe(client: Redis): void {
    let reported = false;
    client.on('error', () => {
      if (!reported) {
        reported = true;
        this.logger.warn('chat_redis_connection_unavailable');
      }
    });
    client.on('ready', () => {
      reported = false;
    });
  }

  private releaseClients(): void {
    const clients = this.clients;
    this.clients = [];
    for (const client of clients) disconnectRedis(client);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.adapterConstructor = undefined;
    this.abort?.abort();
    this.releaseClients();
    // Let the cancelled attempt finish its own timer/listener cleanup.
    await this.connecting?.catch(() => undefined);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
