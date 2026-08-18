import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '../config/env.validation';

/**
 * Client Redis "cru" (fora do BullMQ) pra tudo que não é fila: dedupe de
 * webhook (SET NX + TTL), rate limit de envio, cache de status de instância
 * da uazapi, presença/typing/não-lidas do chat.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(config: ConfigService<Env, true>) {
    this.client = new Redis(config.get('REDIS_URL', { infer: true }));
  }

  onModuleDestroy() {
    return this.client.quit();
  }

  /** true se a chave foi definida agora (primeira vez); false se já existia. */
  async setIfNotExists(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }
}
