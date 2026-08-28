import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatMessageService } from './chat-message.service';

@Module({
  controllers: [ChatController],
  providers: [ChatGateway, ChatMessageService],
  exports: [ChatGateway],
})
export class ChatModule {}
