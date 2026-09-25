import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUE_AUTOMATIONS } from '../queue/queue.module';
import type { AutomationJobData } from './automation.types';

@Injectable()
export class AutomationSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(AutomationSchedulerService.name);
  constructor(
    @InjectQueue(QUEUE_AUTOMATIONS)
    private readonly queue: Queue<AutomationJobData>,
  ) {}

  async onModuleInit() {
    await this.queue.upsertJobScheduler(
      'automation-dispatch-scheduler',
      { every: 15_000 },
      {
        name: 'schedule',
        data: {},
        opts: { removeOnComplete: 20, removeOnFail: 50 },
      },
    );
    await this.queue.add(
      'schedule',
      {},
      { removeOnComplete: 20, removeOnFail: 50 },
    );
    this.logger.log('dispatcher de automações agendado a cada 15 segundos');
  }
}
