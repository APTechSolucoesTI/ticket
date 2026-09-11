import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { QUEUE_COLLECTION } from '../queue/queue.module';
import {
  CollectionDispatchError,
  CollectionDispatchService,
} from './collection-dispatch.service';
import type { CollectionJobData } from './collection.types';

@Processor(QUEUE_COLLECTION)
export class CollectionProcessor extends WorkerHost {
  private readonly logger = new Logger(CollectionProcessor.name);

  constructor(
    @InjectQueue(QUEUE_COLLECTION)
    private readonly queue: Queue<CollectionJobData>,
    private readonly dispatchService: CollectionDispatchService,
  ) {
    super();
  }

  async process(job: Job<CollectionJobData>): Promise<void> {
    if (job.name === 'schedule') {
      const actions = await this.dispatchService.prepareActions();
      try {
        const result = await this.dispatchService.processContractEvents();
        if (
          result.suspended_contracts ||
          result.released_contracts ||
          result.ignored_events ||
          result.failed_events
        ) {
          this.logger.log(
            `contratos suspensos=${result.suspended_contracts} liberados=${result.released_contracts} ignorados=${result.ignored_events} falhas=${result.failed_events}`,
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Falha desconhecida.';
        this.logger.error(`falha ao processar eventos financeiros: ${message}`);
      }
      for (const action of actions) {
        await this.queue.add(
          'dispatch',
          { action },
          {
            jobId: `${action.id}-${action.attempt_count}`,
            removeOnComplete: 100,
            removeOnFail: 100,
          },
        );
      }
      if (actions.length)
        this.logger.log(`${actions.length} cobrança(s) adicionada(s) à fila`);
      return;
    }

    const action = job.data.action;
    try {
      const externalId = await this.dispatchService.dispatch(action);
      await this.dispatchService.finish(action.id, {
        success: true,
        externalId,
      });
      this.logger.log(`ação=${action.id} canal=${action.channel} enviada`);
    } catch (error) {
      const retryable =
        error instanceof CollectionDispatchError ? error.retryable : true;
      const message =
        error instanceof Error ? error.message : 'Falha desconhecida.';
      await this.dispatchService.finish(action.id, {
        success: false,
        error: message,
        retryable,
      });
      this.logger.warn(
        `ação=${action.id} canal=${action.channel} falhou: ${message}`,
      );
    }
  }
}
