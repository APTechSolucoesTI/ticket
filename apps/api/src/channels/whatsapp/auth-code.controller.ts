import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { Public } from '../../auth/public.decorator';
import { InternalServiceGuard } from '../../auth/internal-service.guard';
import { SupabaseService } from '../../supabase/supabase.service';
import { SecretsService } from '../../crypto/secrets.service';
import { UazapiService } from './uazapi.service';

const payload = z.object({
  tenantId: z.uuid(),
  contactId: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
});
const outboundCredentials = z.object({
  base_url: z.string(),
  access_token: z.string(),
});

@ApiExcludeController()
@Controller('channels/whatsapp')
export class AuthCodeController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly secrets: SecretsService,
    private readonly whatsapp: UazapiService,
  ) {}

  @Post('internal-auth-code')
  @Public()
  @UseGuards(InternalServiceGuard)
  @HttpCode(204)
  async send(@Body() body: unknown) {
    const parsed = payload.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Código inválido.');
    const { contactId, tenantId, code } = parsed.data;
    const db = this.supabase.client;
    const [contact, tenant] = await Promise.all([
      db
        .from('contacts')
        .select('phone')
        .eq('id', contactId)
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .maybeSingle(),
      db
        .from('tenants')
        .select(
          'whatsapp_enabled,whatsapp_uazapi_base_url,whatsapp_uazapi_token',
        )
        .eq('id', tenantId)
        .maybeSingle(),
    ]);
    const phone = contact.data?.phone;
    if (
      contact.error ||
      tenant.error ||
      !tenant.data ||
      !phone ||
      !/^\d{10,15}$/.test(phone)
    ) {
      throw new ServiceUnavailableException(
        'Canal de autenticação indisponível.',
      );
    }
    const config = tenant.data;
    try {
      const credentials =
        config.whatsapp_enabled &&
        config.whatsapp_uazapi_base_url &&
        config.whatsapp_uazapi_token
          ? {
              base_url: config.whatsapp_uazapi_base_url,
              access_token: config.whatsapp_uazapi_token,
            }
          : await this.financialOutbound(tenantId);
      if (!credentials) throw new Error('Canal de saída indisponível.');
      const result = await this.whatsapp.sendText(
        credentials.base_url,
        this.secrets.decrypt(credentials.access_token),
        phone,
        `Seu código de acesso ao APTicket é ${code}. Ele expira em 10 minutos. Se você não solicitou, ignore esta mensagem.`,
      );
      if (result.ok) return;
    } catch {
      // Provider details can include private configuration.
    }
    throw new ServiceUnavailableException(
      'Canal de autenticação indisponível.',
    );
  }

  // Use the dedicated outbound number when inbound WhatsApp is disabled.
  private async financialOutbound(tenantId: string) {
    const db = this.supabase.client as unknown as SupabaseClient;
    const { data, error } = await db
      .from('outbound_channels')
      .select('base_url,access_token')
      .eq('tenant_id', tenantId)
      .ilike('name', 'financeiro')
      .eq('active', true)
      .eq('status', 'connected')
      .is('deleted_at', null)
      .limit(2)
      .maybeSingle();
    const parsed = outboundCredentials.safeParse(data);
    return !error && parsed.success ? parsed.data : null;
  }
}
