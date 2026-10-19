import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE_INTER_WEBHOOK } from '../../queue/queue.module';
import { SupabaseService } from '../../supabase/supabase.service';
import type { InterWebhookJobData } from './inter-webhook.controller';

@Processor(QUEUE_INTER_WEBHOOK)
export class InterWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(InterWebhookProcessor.name);

  constructor(private readonly supabase: SupabaseService) {
    super();
  }

  async process(job: Job<InterWebhookJobData>): Promise<void> {
    const response = await this.supabase.client.functions.invoke<unknown>(
      'consultar-cobranca-inter',
      {
        body: {
          request_id: job.data.requestId,
          source: 'webhook',
          event_id: job.data.eventId,
        },
      },
    );
    const data: unknown = response.data;
    const error: unknown = response.error;
    if (
      error ||
      typeof data !== 'object' ||
      data === null ||
      !('ok' in data) ||
      data.ok !== true ||
      !('state' in data) ||
      data.state !== 'synced'
    ) {
      throw new Error('inter_charge_reconciliation_pending');
    }
    this.logger.log(`event=${job.data.eventId} reconciled`);
  }
}
