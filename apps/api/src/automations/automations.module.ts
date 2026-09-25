import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_AUTOMATIONS } from '../queue/queue.module';
import { WhatsappModule } from '../channels/whatsapp/whatsapp.module';
import { AutomationDispatchService } from './automation-dispatch.service';
import { AutomationProcessor } from './automation.processor';
import { AutomationSchedulerService } from './automation-scheduler.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_AUTOMATIONS }),
    WhatsappModule,
  ],
  providers: [
    AutomationDispatchService,
    AutomationProcessor,
    AutomationSchedulerService,
  ],
})
export class AutomationsModule {}
