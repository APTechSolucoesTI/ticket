import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE_WHATSAPP_INBOUND } from '../../queue/queue.module';
import { WhatsappWebhookService } from './whatsapp-webhook.service';
import { extractExternalId, type UnknownRec } from './whatsapp-parser.util';
import { RedisService } from '../../queue/redis.service';

interface WhatsappInboundJobData {
  tenantId: string;
  payload: UnknownRec;
}

@Processor(QUEUE_WHATSAPP_INBOUND)
export class WhatsappInboundProcessor extends WorkerHost {
  private readonly logger = new Logger(WhatsappInboundProcessor.name);

  constructor(
    private readonly webhook: WhatsappWebhookService,
    private readonly redis: RedisService,
  ) {
    super();
  }

  async process(job: Job<WhatsappInboundJobData>): Promise<void> {
    const outcome = await this.webhook
      .handle(job.data.tenantId, job.data.payload)
      .catch(async (error: unknown) => {
        // The scanner failed before a message was persisted. Release this
        // temporary dedupe reservation so BullMQ's retry can ingest the file.
        const externalId = extractExternalId(job.data.payload);
        if (error instanceof ServiceUnavailableException && externalId) {
          await this.redis.client.del(
            `whatsapp:dedup:${job.data.tenantId}:${externalId}`,
          );
        }
        throw error;
      });
    if (outcome.kind === 'ticket') {
      this.logger.log(`tenant=${job.data.tenantId} ticket=${outcome.ticketId}`);
    } else if (outcome.kind === 'pending') {
      this.logger.log(
        `tenant=${job.data.tenantId} pending (${outcome.reason})`,
      );
    }
  }
}
