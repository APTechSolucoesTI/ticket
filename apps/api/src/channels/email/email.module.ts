import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_EMAIL_POLLING } from '../../queue/queue.module';
import { EmailController } from './email.controller';
import { EmailAccountService } from './email-account.service';
import { EmailChannelService } from './email-channel.service';
import { EmailPollingService } from './email-polling.service';
import { EmailPollingProcessor } from './email-polling.processor';
import { EmailSchedulerService } from './email-scheduler.service';
import { EmailSenderService } from './email-sender.service';
import { EmailReplyService } from './email-reply.service';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_EMAIL_POLLING })],
  controllers: [EmailController],
  providers: [
    EmailAccountService,
    EmailChannelService,
    EmailPollingService,
    EmailPollingProcessor,
    EmailSchedulerService,
    EmailSenderService,
    EmailReplyService,
  ],
  exports: [EmailChannelService, EmailPollingService],
})
export class EmailModule {}
