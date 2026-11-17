import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '../config/env.validation';
import {
  FIXED_WINDOW_RATE_LIMIT_SCRIPT,
  validateRateLimit,
  rateLimitResult,
} from './redis-rate-limit';
import { closeRedis } from './redis-lifecycle';

/**
 * Client Redis "cru" (fora do BullMQ) pra tudo que não é fila: dedupe de
 * webhook (SET NX + TTL), rate limit de envio, cache de status de instância
 * da uazapi, presença/typing/não-lidas do chat.
 */
@Injectable()
export class RedisService implements OnApplicationShutdown {
  readonly client: Redis;
  private shutdown: Promise<void> | undefined;

  constructor(config: ConfigService<Env, true>) {
    this.client = new Redis(config.get('REDIS_URL', { infer: true }), {
      disconnectTimeout: 0,
    });
  }

  onApplicationShutdown(): Promise<void> {
    // This global provider must outlive the consumers' shutdown hooks.
    return (this.shutdown ??= closeRedis(this.client));
  }

  /** true se a chave foi definida agora (primeira vez); false se já existia. */
  async setIfNotExists(
    key: string,
    ttlSeconds: number,
    value = '1',
  ): Promise<boolean> {
    const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  /** Release only the caller's reservation, atomically across API replicas. */
  async deleteIfValue(key: string, value: string): Promise<boolean> {
    const deleted = await this.client.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
      1,
      key,
      value,
    );
    return deleted === 1;
  }

  /**
   * Janela fixa compartilhada pelas réplicas e consumidores da API.
   * Contador e expiração são tratados pela mesma execução Lua, incluindo
   * recuperação de contadores legados sem TTL.
   */
  async checkRateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    validateRateLimit(limit, windowSeconds);
    const result: unknown = await this.client.eval(
      FIXED_WINDOW_RATE_LIMIT_SCRIPT,
      1,
      key,
      windowSeconds,
    );
    return rateLimitResult(result, limit);
  }
}
