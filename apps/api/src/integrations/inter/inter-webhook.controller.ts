import {
  BadRequestException,
  Controller,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Request } from 'express';
import { ZodError, z } from 'zod';
import { Public } from '../../auth/public.decorator';
import { RedisService } from '../../queue/redis.service';
import { QUEUE_INTER_WEBHOOK } from '../../queue/queue.module';
import { SupabaseService } from '../../supabase/supabase.service';
import { hashWebhookToken, normalizeInterCallback } from './inter-webhook.util';

export type InterWebhookJobData = { eventId: string; requestId: string };

const acceptedSchema = z.object({
  events: z.array(
    z.object({
      event_id: z.string().uuid(),
      request_id: z.string().uuid(),
      status: z.enum(['received', 'queued', 'verifying', 'verified', 'failed']),
      attempt_count: z.number().int().nonnegative(),
    }),
  ),
  ignored: z.number().int().nonnegative(),
});

@ApiExcludeController()
@Controller('webhooks/inter')
export class InterWebhookController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly redis: RedisService,
    @InjectQueue(QUEUE_INTER_WEBHOOK)
    private readonly queue: Queue<InterWebhookJobData>,
  ) {}

  @Public()
  @Post(':environment')
  @HttpCode(204)
  async receive(
    @Param('environment') environment: string,
    @Query('token') token: string | undefined,
    @Req() request: Request,
  ): Promise<void> {
    if (!['sandbox', 'production'].includes(environment)) {
      throw new BadRequestException('invalid_environment');
    }
    const ip = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const limit = await this.redis.checkRateLimit(
      `inter-webhook:ip:${ip}`,
      120,
      5 * 60,
    );
    if (!limit.allowed) throw new ServiceUnavailableException('rate_limited');

    let secretHash: string;
    let events;
    try {
      secretHash = hashWebhookToken(token ?? '');
      events = normalizeInterCallback(request.body);
    } catch (error) {
      if (error instanceof ZodError)
        throw new BadRequestException('invalid_callback');
      throw new UnauthorizedException('invalid_token');
    }

    const client = this.supabase.client as unknown as {
      rpc(
        name: string,
        args: Record<string, unknown>,
      ): Promise<{ data: unknown; error: { code?: string } | null }>;
    };
    const { data, error } = await client.rpc('accept_inter_charge_webhook', {
      p_environment: environment,
      p_secret_hash: secretHash,
      p_events: events,
    });
    if (error) {
      if (error.code === '42501')
        throw new UnauthorizedException('invalid_token');
      if (error.code === '22023')
        throw new BadRequestException('invalid_callback');
      throw new ServiceUnavailableException('callback_unavailable');
    }
    const accepted = acceptedSchema.parse(data);
    const pending = accepted.events.filter(
      (event) => event.status !== 'verified',
    );
    if (pending.length === 0) return;

    try {
      await this.queue.addBulk(
        pending.map((event) => ({
          name: 'verify-charge',
          data: { eventId: event.event_id, requestId: event.request_id },
          opts: {
            jobId: `${event.event_id}-${event.attempt_count}`,
            attempts: 5,
            backoff: { type: 'exponential', delay: 15_000 },
            removeOnComplete: 1000,
            removeOnFail: 1000,
          },
        })),
      );
      await client.rpc('mark_inter_webhook_events_queued', {
        p_events: pending.map((event) => event.event_id),
      });
    } catch {
      throw new ServiceUnavailableException('queue_unavailable');
    }
  }
}
