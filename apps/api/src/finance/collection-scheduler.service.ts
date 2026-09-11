import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUE_COLLECTION } from '../queue/queue.module';
import type { CollectionJobData } from './collection.types';

@Injectable()
export class CollectionSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(CollectionSchedulerService.name);

  constructor(
    @InjectQueue(QUEUE_COLLECTION)
    private readonly queue: Queue<CollectionJobData>,
  ) {}

  async onModuleInit() {
    await this.queue.upsertJobScheduler(
      'collection-scheduler',
      { every: 15 * 60_000 },
      {
        name: 'schedule',
        data: {} as CollectionJobData,
        opts: { removeOnComplete: 20, removeOnFail: 50 },
      },
    );
    await this.queue.add('schedule', {} as CollectionJobData, {
      jobId: `collection-startup-${Date.now()}`,
      removeOnComplete: 20,
      removeOnFail: 50,
    });
    this.logger.log('régua de cobrança agendada a cada 15 minutos');
  }
}
