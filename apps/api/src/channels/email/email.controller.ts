import { Body, Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/current-user.decorator';
import { RequirePermission } from '../../auth/require-permission.decorator';
import type { AuthContext } from '../../auth/supabase-auth.guard';
import { EmailAccountService } from './email-account.service';
import { EmailPollingService } from './email-polling.service';
import { EmailReplyService } from './email-reply.service';
import { UpsertEmailAccountDto } from './dto/upsert-email-account.dto';
import { SendEmailReplyDto } from './dto/send-email-reply.dto';

// Rotas seguem o contrato original do prompt (`/channels/email/accounts`),
// mas como o domínio real do APTicket tem uma conta de e-mail por tenant
// (colunas em apticket.tenants, não uma tabela separada de múltiplas
// contas), `:id` é sempre o próprio tenantId do usuário autenticado — o
// path fica compatível com o contrato pedido sem inventar um conceito que
// não existe no schema.
@ApiTags('email')
@ApiBearerAuth()
@Controller('channels/email/accounts')
export class EmailController {
  constructor(
    private readonly accounts: EmailAccountService,
    private readonly polling: EmailPollingService,
    private readonly reply: EmailReplyService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Conta de e-mail do tenant (null se ainda não configurada)',
  })
  list(@CurrentUser() auth: AuthContext) {
    return this.accounts
      .get(auth.tenantId)
      .then((account) => (account ? [account] : []));
  }

  @Post()
  @RequirePermission('canais', 'manage')
  @ApiOperation({
    summary: 'Cria/atualiza a conta de e-mail (IMAP/SMTP) do tenant',
  })
  create(@CurrentUser() auth: AuthContext, @Body() dto: UpsertEmailAccountDto) {
    return this.accounts.upsert(auth.tenantId, dto);
  }

  @Patch(':id')
  @RequirePermission('canais', 'manage')
  @ApiOperation({ summary: 'Atualiza a conta de e-mail' })
  update(@CurrentUser() auth: AuthContext, @Body() dto: UpsertEmailAccountDto) {
    return this.accounts.upsert(auth.tenantId, dto);
  }

  @Delete(':id')
  @RequirePermission('canais', 'manage')
  @ApiOperation({ summary: 'Remove a configuração de e-mail do tenant' })
  remove(@CurrentUser() auth: AuthContext) {
    return this.accounts.remove(auth.tenantId);
  }

  @Post(':id/test-connection')
  @RequirePermission('canais', 'manage')
  @ApiOperation({
    summary: 'Testa IMAP com as credenciais salvas ou informadas no corpo',
  })
  testConnection(
    @CurrentUser() auth: AuthContext,
    @Body() body: Partial<UpsertEmailAccountDto>,
  ) {
    return this.accounts.testConnection(auth.tenantId, body);
  }

  @Post(':id/sync')
  @RequirePermission('canais', 'send')
  @ApiOperation({
    summary: "Sincroniza a caixa agora (botão 'Sincronizar agora')",
  })
  sync(@CurrentUser() auth: AuthContext) {
    return this.polling.pollTenant(auth.tenantId);
  }

  @Post(':id/send')
  @RequirePermission('canais', 'send')
  @ApiOperation({ summary: 'Responde um ticket de origem e-mail' })
  send(@CurrentUser() auth: AuthContext, @Body() dto: SendEmailReplyDto) {
    return this.reply.reply(
      auth.tenantId,
      auth.userId,
      dto.ticketId,
      dto.content,
    );
  }
}
