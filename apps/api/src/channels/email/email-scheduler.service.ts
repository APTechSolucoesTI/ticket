import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUE_EMAIL_POLLING } from '../../queue/queue.module';
import { SupabaseService } from '../../supabase/supabase.service';

interface EmailPollJobData {
  tenantId: string;
}

/**
 * Um job repetível do BullMQ por tenant, no intervalo próprio de cada um
 * (tenants.email_poll_interval_minutes) - troca o pg_cron fixo de 1 minuto
 * que existia antes. `jobId = tenantId` garante que reconfigurar o
 * intervalo substitui o agendamento em vez de duplicar.
 */
@Injectable()
export class EmailSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(EmailSchedulerService.name);

  constructor(
    @InjectQueue(QUEUE_EMAIL_POLLING)
    private readonly queue: Queue<EmailPollJobData>,
    private readonly supabase: SupabaseService,
  ) {}

  async onModuleInit() {
    const { data: tenants, error } = await this.supabase.client
      .from('tenants')
      .select('id, email_poll_interval_minutes')
      .eq('email_enabled', true)
      .not('email_imap_host', 'is', null);
    if (error) {
      this.logger.error(
        `failed to load tenants for initial scheduling: ${error.message}`,
      );
      return;
    }
    for (const t of tenants ?? []) {
      await this.schedule(t.id, t.email_poll_interval_minutes ?? 5);
    }
    this.logger.log(
      `agendado polling de e-mail pra ${tenants?.length ?? 0} tenant(s)`,
    );
  }

  async schedule(tenantId: string, intervalMinutes: number) {
    // upsertJobScheduler substitui o antigo `repeat` de queue.add() no BullMQ
    // v6 - o próprio jobSchedulerId (= tenantId) já reagenda em vez de
    // duplicar, então não precisa remover antes.
    await this.queue.upsertJobScheduler(
      tenantId,
      { every: intervalMinutes * 60_000 },
      {
        name: 'poll',
        data: { tenantId },
        opts: { removeOnComplete: 20, removeOnFail: 20 },
      },
    );
  }

  async unschedule(tenantId: string) {
    await this.queue.removeJobScheduler(tenantId);
  }
}
