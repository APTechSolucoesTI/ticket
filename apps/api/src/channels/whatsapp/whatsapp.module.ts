import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  QUEUE_WHATSAPP_INBOUND,
  QUEUE_WHATSAPP_OUTBOUND,
} from '../../queue/queue.module';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { WhatsappInstanceService } from './whatsapp-instance.service';
import { WhatsappWebhookService } from './whatsapp-webhook.service';
import { WhatsappInboundProcessor } from './whatsapp-inbound.processor';
import { WhatsappReplyService } from './whatsapp-reply.service';
import { UazapiService } from './uazapi.service';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_WHATSAPP_INBOUND },
      { name: QUEUE_WHATSAPP_OUTBOUND },
    ),
  ],
  controllers: [WhatsappController, WhatsappWebhookController],
  providers: [
    WhatsappInstanceService,
    WhatsappWebhookService,
    WhatsappInboundProcessor,
    WhatsappReplyService,
    UazapiService,
  ],
})
export class WhatsappModule {}
