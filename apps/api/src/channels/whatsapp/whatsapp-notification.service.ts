import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { SupabaseService } from '../../supabase/supabase.service';
import { SecretsService } from '../../crypto/secrets.service';
import { RedisService } from '../../queue/redis.service';
import { UazapiService } from './uazapi.service';
import type { Env } from '../../config/env.validation';

export const STATUS_TEXT = {
  in_progress: 'Seu chamado está em atendimento. Retornaremos em breve.',
  pending: 'Seu chamado está pendente. Aguardamos retorno para prosseguir.',
  resolved:
    'Seu chamado foi resolvido. Se o problema persistir, responda esta mensagem para reabrir.',
  closed: 'Seu chamado foi fechado. Obrigado por escolher nosso suporte!',
};

@Injectable()
export class WhatsappNotificationService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly secrets: SecretsService,
    private readonly redis: RedisService,
    private readonly uazapi: UazapiService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private async ticket(tenantId: string, ticketId: string) {
    const { data, error } = await this.supabase.client
      .from('tickets')
      .select('id,tenant_id,contact_id,channel,contacts(phone)')
      .eq('id', ticketId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw new ServiceUnavailableException();
    if (!data) throw new NotFoundException('Ticket não encontrado');
    return data;
  }

  private async send(tenantId: string, ticketId: string, text: string) {
    const ticket = await this.ticket(tenantId, ticketId);
    if (ticket.channel !== 'whatsapp' || !ticket.contacts?.phone)
      return { skipped: true };
    const { data: tenant, error } = await this.supabase.client
      .from('tenants')
      .select('whatsapp_enabled,whatsapp_uazapi_base_url,whatsapp_uazapi_token')
      .eq('id', tenantId)
      .maybeSingle();
    if (error) throw new ServiceUnavailableException();
    if (
      !tenant?.whatsapp_enabled ||
      !tenant.whatsapp_uazapi_base_url ||
      !tenant.whatsapp_uazapi_token
    )
      return { skipped: true };
    const rate = await this.redis.checkRateLimit(
      `whatsapp:send:${tenantId}`,
      20,
      60,
    );
    if (!rate.allowed)
      throw new HttpException(
        'Limite de envio atingido',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const result = await this.uazapi.sendText(
      tenant.whatsapp_uazapi_base_url,
      this.secrets.decrypt(tenant.whatsapp_uazapi_token),
      ticket.contacts.phone,
      text,
    );
    const { error: insertError } = await this.supabase.client
      .from('messages')
      .insert({
        tenant_id: tenantId,
        ticket_id: ticketId,
        content: text,
        author_type: 'system',
        is_internal: false,
        channel: 'whatsapp',
        delivery_status: result.ok ? 'sent' : 'failed',
      });
    if (insertError) throw new ServiceUnavailableException();
    return { skipped: false, ok: result.ok };
  }

  notify(tenantId: string, ticketId: string, status: keyof typeof STATUS_TEXT) {
    return this.send(tenantId, ticketId, STATUS_TEXT[status]);
  }

  async invite(tenantId: string, ticketId: string) {
    const ticket = await this.ticket(tenantId, ticketId);
    const { data: existing, error } = await this.supabase.client
      .from('csat_responses')
      .select('id,token')
      .eq('tenant_id', tenantId)
      .eq('ticket_id', ticketId)
      .maybeSingle();
    if (error) throw new ServiceUnavailableException();
    const token = existing?.token ?? randomUUID().replace(/-/g, '');
    if (!existing?.token) {
      const values = { token, sent_at: new Date().toISOString() };
      const result = existing
        ? await this.supabase.client
            .from('csat_responses')
            .update(values)
            .eq('id', existing.id)
            .eq('tenant_id', tenantId)
        : await this.supabase.client.from('csat_responses').insert({
            ...values,
            tenant_id: tenantId,
            ticket_id: ticketId,
            contact_id: ticket.contact_id,
          });
      if (result.error) throw new ServiceUnavailableException();
    }
    if (ticket.channel === 'whatsapp') {
      const origin = this.config
        .get('CORS_ORIGIN', { infer: true })
        .replace(/\/+$/, '');
      await this.send(
        tenantId,
        ticketId,
        `Como você avalia nosso atendimento? Responda em 1 clique: ${origin}/csat/${token}`,
      );
    }
    return { ok: true, token };
  }
}
