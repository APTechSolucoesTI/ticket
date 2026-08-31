import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { RedisService } from './redis.service';

export const QUEUE_EMAIL_POLLING = 'email-polling';
export const QUEUE_EMAIL_SEND = 'email-send';
export const QUEUE_WHATSAPP_INBOUND = 'whatsapp-inbound';
export const QUEUE_WHATSAPP_OUTBOUND = 'whatsapp-outbound';
export const QUEUE_NOTIFICATION_FANOUT = 'notification-fanout';

/**
 * Conexão Redis central pro BullMQ. Cada módulo de canal registra as
 * próprias filas com `BullModule.registerQueue({ name: QUEUE_X })` - a
 * conexão só é definida uma vez aqui (`forRootAsync`), evitando um
 * import circular entre email/whatsapp/chat só pra compartilhar isso.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const url: string = config.get('REDIS_URL', { infer: true });
        return { connection: { url } };
      },
    }),
  ],
  providers: [RedisService],
  exports: [BullModule, RedisService],
})
export class QueueModule {}
