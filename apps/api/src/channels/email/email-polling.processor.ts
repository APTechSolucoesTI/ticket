import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE_EMAIL_POLLING } from '../../queue/queue.module';
import { EmailPollingService } from './email-polling.service';

interface EmailPollJobData {
  tenantId: string;
}

/** Consome o job repetível — um por tenant, agendado por EmailSchedulerService. */
@Processor(QUEUE_EMAIL_POLLING)
export class EmailPollingProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailPollingProcessor.name);

  constructor(private readonly polling: EmailPollingService) {
    super();
  }

  async process(job: Job<EmailPollJobData>): Promise<void> {
    const result = await this.polling.pollTenant(job.data.tenantId);
    if (result.errors.length) {
      this.logger.warn(
        `tenant ${job.data.tenantId} poll had errors: ${result.errors.join('; ')}`,
      );
    } else if (result.processed > 0) {
      this.logger.log(
        `tenant ${job.data.tenantId}: ${result.created} ticket(s) criado(s) de ${result.processed} mensagem(ns)`,
      );
    }
  }
}
