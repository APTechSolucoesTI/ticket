import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_COLLECTION } from '../queue/queue.module';
import { EmailModule } from '../channels/email/email.module';
import { WhatsappModule } from '../channels/whatsapp/whatsapp.module';
import { CollectionSchedulerService } from './collection-scheduler.service';
import { CollectionProcessor } from './collection.processor';
import { CollectionDispatchService } from './collection-dispatch.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_COLLECTION }),
    EmailModule,
    WhatsappModule,
  ],
  providers: [
    CollectionSchedulerService,
    CollectionProcessor,
    CollectionDispatchService,
  ],
})
export class FinanceModule {}
