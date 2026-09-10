import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_INTER_WEBHOOK } from '../../queue/queue.module';
import { InterWebhookController } from './inter-webhook.controller';
import { InterWebhookProcessor } from './inter-webhook.processor';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_INTER_WEBHOOK })],
  controllers: [InterWebhookController],
  providers: [InterWebhookProcessor],
})
export class InterModule {}
