import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/current-user.decorator';
import { RequirePermission } from '../../auth/require-permission.decorator';
import type { AuthContext } from '../../auth/supabase-auth.guard';
import { ChatGateway } from './chat.gateway';
import { ChatMessageService } from './chat-message.service';
import { SendChatMessageDto } from './dto/send-chat-message.dto';

@ApiTags('chat')
@ApiBearerAuth()
@Controller('channels/chat')
export class ChatController {
  constructor(
    private readonly messages: ChatMessageService,
    private readonly gateway: ChatGateway,
  ) {}

  @Post('messages')
  @RequirePermission('tickets', 'edit')
  @ApiOperation({ summary: 'Responde um ticket de origem chat' })
  async send(
    @CurrentUser() auth: AuthContext,
    @Body() dto: SendChatMessageDto,
  ) {
    const message = await this.messages.sendAgentMessage(
      auth.tenantId,
      auth.userId,
      dto.ticketId,
      dto.content,
    );
    this.gateway.publishMessage(message);
    return { ok: true as const, messageId: message.id };
  }
}
