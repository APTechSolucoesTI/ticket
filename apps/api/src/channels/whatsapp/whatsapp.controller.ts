import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/current-user.decorator';
import { RequirePermission } from '../../auth/require-permission.decorator';
import type { AuthContext } from '../../auth/supabase-auth.guard';
import { WhatsappInstanceService } from './whatsapp-instance.service';
import { WhatsappReplyService } from './whatsapp-reply.service';
import { UpsertWhatsappInstanceDto } from './dto/upsert-whatsapp-instance.dto';
import { WhatsappSendMessageDto } from './dto/whatsapp-send-message.dto';

// `:id` do contrato original também é sempre o tenantId (ver nota no
// EmailController) — uma instância uazapi por tenant no domínio real.
@ApiTags('whatsapp')
@ApiBearerAuth()
@Controller('channels/whatsapp/instances')
export class WhatsappController {
  constructor(
    private readonly instances: WhatsappInstanceService,
    private readonly reply: WhatsappReplyService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Instância uazapi do tenant, salva no banco (sem chamar a uazapi)',
  })
  list(@CurrentUser() auth: AuthContext) {
    return this.instances
      .get(auth.tenantId)
      .then((account) => (account ? [account] : []));
  }

  @Post()
  @RequirePermission('canais', 'manage')
  @ApiOperation({ summary: 'Cria/atualiza a instância uazapi do tenant' })
  create(
    @CurrentUser() auth: AuthContext,
    @Body() dto: UpsertWhatsappInstanceDto,
  ) {
    return this.instances.upsert(auth.tenantId, dto);
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Status da conexão (conectado/desconectado)' })
  status(@CurrentUser() auth: AuthContext) {
    return this.instances.status(auth.tenantId);
  }

  @Get(':id/qrcode')
  @ApiOperation({ summary: 'Gera QR code pra parear o número' })
  qrcode(@CurrentUser() auth: AuthContext) {
    return this.instances.qrcode(auth.tenantId);
  }

  @Post(':id/disconnect')
  @RequirePermission('canais', 'manage')
  @ApiOperation({ summary: 'Desconecta a instância' })
  disconnect(@CurrentUser() auth: AuthContext) {
    return this.instances.disconnect(auth.tenantId);
  }

  @Post(':id/send')
  @RequirePermission('canais', 'send')
  @ApiOperation({ summary: 'Responde um ticket de origem WhatsApp' })
  send(@CurrentUser() auth: AuthContext, @Body() dto: WhatsappSendMessageDto) {
    return this.reply.reply(
      auth.tenantId,
      auth.userId,
      dto.ticketId,
      dto.content,
    );
  }
}
