import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/current-user.decorator';
import { RequirePermission } from '../../auth/require-permission.decorator';
import type { AuthContext } from '../../auth/supabase-auth.guard';
import { WhatsappInstanceService } from './whatsapp-instance.service';
import { WhatsappReplyService } from './whatsapp-reply.service';
import { UpsertWhatsappInstanceDto } from './dto/upsert-whatsapp-instance.dto';
import {
  WhatsappCallDto,
  WhatsappSendContactDto,
  WhatsappSendLocationDto,
  WhatsappSendMediaDto,
  WhatsappSendMessageDto,
  WhatsappSendStickerDto,
} from './dto/whatsapp-send-message.dto';

// `:id` do contrato original também é sempre o tenantId (ver nota no
// EmailController) - uma instância uazapi por tenant no domínio real.
@ApiTags('whatsapp')
@ApiBearerAuth()
@Controller('channels/whatsapp/instances')
export class WhatsappController {
  constructor(
    private readonly instances: WhatsappInstanceService,
    private readonly reply: WhatsappReplyService,
  ) {}

  @Get()
  @RequirePermission('canais', 'view')
  @ApiOperation({
    summary: 'Instância uazapi do tenant, salva no banco (sem chamar a uazapi)',
  })
  list(@CurrentUser() auth: AuthContext) {
    return this.instances
      .get(auth.tenantId)
      .then((account) => (account ? [account] : []));
  }

  @Post()
  @RequirePermission('canais', 'edit')
  @ApiOperation({ summary: 'Cria/atualiza a instância uazapi do tenant' })
  create(
    @CurrentUser() auth: AuthContext,
    @Body() dto: UpsertWhatsappInstanceDto,
  ) {
    return this.instances.upsert(auth.tenantId, dto);
  }

  @Get(':id/status')
  @RequirePermission('canais', 'view')
  @ApiOperation({ summary: 'Status da conexão (conectado/desconectado)' })
  status(@CurrentUser() auth: AuthContext) {
    return this.instances.status(auth.tenantId);
  }

  @Get(':id/qrcode')
  @RequirePermission('canais', 'edit')
  @ApiOperation({ summary: 'Gera QR code pra parear o número' })
  qrcode(@CurrentUser() auth: AuthContext) {
    return this.instances.qrcode(auth.tenantId);
  }

  @Post(':id/disconnect')
  @RequirePermission('canais', 'edit')
  @ApiOperation({ summary: 'Desconecta a instância' })
  disconnect(@CurrentUser() auth: AuthContext) {
    return this.instances.disconnect(auth.tenantId);
  }

  @Post(':id/send')
  @RequirePermission('tickets', 'edit')
  @ApiOperation({ summary: 'Responde um ticket de origem WhatsApp' })
  send(@CurrentUser() auth: AuthContext, @Body() dto: WhatsappSendMessageDto) {
    return this.reply.reply(
      auth.tenantId,
      auth.userId,
      dto.ticketId,
      dto.content,
    );
  }

  @Post(':id/send-media')
  @RequirePermission('tickets', 'edit')
  @ApiOperation({
    summary: 'Envia imagem, documento, Ã¡udio ou vÃ­deo via uazapi',
  })
  sendMedia(
    @CurrentUser() auth: AuthContext,
    @Body() dto: WhatsappSendMediaDto,
  ) {
    return this.reply.replyMedia(auth.tenantId, auth.userId, dto);
  }

  @Post(':id/send-contact')
  @RequirePermission('tickets', 'edit')
  @ApiOperation({ summary: 'Envia um contato pelo WhatsApp' })
  sendContact(
    @CurrentUser() auth: AuthContext,
    @Body() dto: WhatsappSendContactDto,
  ) {
    return this.reply.replyContact(auth.tenantId, auth.userId, dto);
  }

  @Post(':id/send-location')
  @RequirePermission('tickets', 'edit')
  @ApiOperation({ summary: 'Envia uma localização pelo WhatsApp' })
  sendLocation(
    @CurrentUser() auth: AuthContext,
    @Body() dto: WhatsappSendLocationDto,
  ) {
    return this.reply.replyLocation(auth.tenantId, auth.userId, dto);
  }

  @Post(':id/send-sticker')
  @RequirePermission('tickets', 'edit')
  @ApiOperation({ summary: 'Envia uma figurinha pelo WhatsApp' })
  sendSticker(
    @CurrentUser() auth: AuthContext,
    @Body() dto: WhatsappSendStickerDto,
  ) {
    return this.reply.replySticker(auth.tenantId, auth.userId, dto);
  }

  @Post(':id/call')
  @RequirePermission('tickets', 'edit')
  @ApiOperation({ summary: 'Inicia uma ligação pelo WhatsApp' })
  call(@CurrentUser() auth: AuthContext, @Body() dto: WhatsappCallDto) {
    return this.reply.call(auth.tenantId, auth.userId, dto);
  }
}
