import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { QUEUE_AUTOMATIONS } from '../queue/queue.module';
import { AutomationDispatchService } from './automation-dispatch.service';
import type { AutomationJobData } from './automation.types';

@Processor(QUEUE_AUTOMATIONS)
export class AutomationProcessor extends WorkerHost {
  private readonly logger = new Logger(AutomationProcessor.name);
  constructor(
    @InjectQueue(QUEUE_AUTOMATIONS)
    private readonly queue: Queue<AutomationJobData>,
    private readonly dispatch: AutomationDispatchService,
  ) {
    super();
  }

  async process(job: Job<AutomationJobData>) {
    if (job.name === 'schedule') {
      const dispatches = await this.dispatch.claim();
      for (const item of dispatches) {
        await this.queue.add(
          'dispatch',
          { dispatch: item },
          {
            jobId: `${item.id}-${item.attempt_count}`,
            removeOnComplete: 100,
            removeOnFail: 100,
          },
        );
      }
      return;
    }
    const item = job.data.dispatch;
    if (!item) return;
    try {
      await this.dispatch.process(item);
      await this.dispatch.finish(item.id, true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Falha desconhecida.';
      await this.dispatch.finish(item.id, false, message);
      this.logger.warn(`automação dispatch=${item.id} falhou: ${message}`);
    }
  }
}
