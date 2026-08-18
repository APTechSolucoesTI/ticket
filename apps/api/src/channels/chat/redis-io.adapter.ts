import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import type { Env } from '../../config/env.validation';

type SocketIoAdapterFn = ReturnType<typeof createAdapter>;

// Sem isso, duas instâncias da API atrás de um load balancer não conseguem
// entregar mensagem de uma sessão conectada na instância A pra uma sessão
// conectada na instância B — o Redis Pub/Sub é quem faz essa ponte. Exigido
// explicitamente pelo prompt como validação de que o WhatsApp/chat
// escalam horizontalmente de verdade.
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: SocketIoAdapterFn;

  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const config = this.app.get(ConfigService<Env, true>);
    const url = config.get('REDIS_URL', { infer: true });
    const pubClient = new Redis(url);
    const subClient = pubClient.duplicate();
    await Promise.all([
      new Promise((resolve) => pubClient.once('ready', resolve)),
      new Promise((resolve) => subClient.once('ready', resolve)),
    ]);
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
