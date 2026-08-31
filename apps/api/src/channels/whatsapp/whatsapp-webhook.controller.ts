import {
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Request, Response } from 'express';
import { Public } from '../../auth/public.decorator';
import { SupabaseService } from '../../supabase/supabase.service';
import { RedisService } from '../../queue/redis.service';
import { secureEquals } from '../../crypto/secure-compare';
import { QUEUE_WHATSAPP_INBOUND } from '../../queue/queue.module';
import type { UnknownRec } from './whatsapp-parser.util';

interface WhatsappInboundJobData {
  tenantId: string;
  payload: UnknownRec;
}

// Público (sem JWT de usuário) - a uazapi autentica com um segredo próprio
// por tenant (tenants.whatsapp_webhook_secret), igual antes em
// apps/web/src/routes/api/public/hooks/uazapi/$tenantId.ts. Só valida e
// enfileira; o processamento de verdade roda no WhatsappInboundProcessor,
// então um pico de eventos ou uma falha transitória no Postgres não perde
// mensagem - o BullMQ tenta de novo.
@ApiExcludeController()
@Controller('webhooks/whatsapp')
export class WhatsappWebhookController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly redis: RedisService,
    @InjectQueue(QUEUE_WHATSAPP_INBOUND)
    private readonly queue: Queue<WhatsappInboundJobData>,
  ) {}

  @Public()
  @Post(':tenantId')
  @HttpCode(200)
  async receive(
    @Param('tenantId') tenantId: string,
    @Query('secret') querySecret: string | undefined,
    @Headers() headers: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const ipLimit = await this.redis.checkRateLimit(
      `uazapi-webhook:ip:${ip}`,
      300,
      5 * 60,
    );
    if (!ipLimit.allowed) {
      res.setHeader('Retry-After', String(ipLimit.retryAfterSeconds));
      throw new ServiceUnavailableException('rate_limited');
    }
    const tenantLimit = await this.redis.checkRateLimit(
      `uazapi-webhook:tenant:${tenantId}`,
      300,
      5 * 60,
    );
    if (!tenantLimit.allowed) {
      res.setHeader('Retry-After', String(tenantLimit.retryAfterSeconds));
      throw new ServiceUnavailableException('rate_limited');
    }

    const payload = req.body as UnknownRec;
    const bearerSecret = headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const providedSecret =
      querySecret ??
      headers['x-webhook-secret'] ??
      headers['x-uazapi-secret'] ??
      headers['x-api-key'] ??
      headers['token'] ??
      bearerSecret ??
      '';

    const { data: tenant } = await this.supabase.client
      .from('tenants')
      .select('id, whatsapp_enabled, whatsapp_webhook_secret')
      .eq('id', tenantId)
      .maybeSingle();

    if (!tenant?.whatsapp_enabled) {
      res.status(404).json({ error: 'tenant_not_configured' });
      return;
    }

    const payloadSecret =
      typeof payload.secret === 'string' ? payload.secret : '';
    const resolvedSecret = providedSecret || payloadSecret;
    if (
      !tenant.whatsapp_webhook_secret ||
      !secureEquals(tenant.whatsapp_webhook_secret, resolvedSecret)
    ) {
      throw new UnauthorizedException('invalid_secret');
    }

    await this.queue.add(
      'inbound',
      { tenantId, payload },
      {
        removeOnComplete: 500,
        removeOnFail: 500,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );

    res.json({ ok: true, queued: true });
  }
}
