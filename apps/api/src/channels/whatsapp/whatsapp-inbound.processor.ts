import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE_WHATSAPP_INBOUND } from '../../queue/queue.module';
import { WhatsappWebhookService } from './whatsapp-webhook.service';
import type { UnknownRec } from './whatsapp-parser.util';

interface WhatsappInboundJobData {
  tenantId: string;
  payload: UnknownRec;
}

@Processor(QUEUE_WHATSAPP_INBOUND)
export class WhatsappInboundProcessor extends WorkerHost {
  private readonly logger = new Logger(WhatsappInboundProcessor.name);

  constructor(private readonly webhook: WhatsappWebhookService) {
    super();
  }

  async process(job: Job<WhatsappInboundJobData>): Promise<void> {
    const outcome = await this.webhook.handle(
      job.data.tenantId,
      job.data.payload,
    );
    if (outcome.kind === 'ticket') {
      this.logger.log(`tenant=${job.data.tenantId} ticket=${outcome.ticketId}`);
    } else if (outcome.kind === 'pending') {
      this.logger.log(
        `tenant=${job.data.tenantId} pending (${outcome.reason})`,
      );
    }
  }
}
