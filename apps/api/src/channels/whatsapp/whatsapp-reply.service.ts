import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { SecretsService } from '../../crypto/secrets.service';
import { RedisService } from '../../queue/redis.service';
import { UazapiService } from './uazapi.service';
import type { WhatsappSendMediaDto } from './dto/whatsapp-send-message.dto';

// Portado de sendWhatsAppReply em apps/web/src/lib/whatsapp.functions.ts.
// Diferença: token da uazapi agora vem criptografado do banco, e o envio
// passa por um rate limit no Redis antes de chamar a uazapi (evita bloqueio
// do número por excesso de chamadas — pedido explícito do prompt).
const SEND_RATE_LIMIT = 20; // mensagens por minuto por tenant
const SEND_RATE_WINDOW_SECONDS = 60;

@Injectable()
export class WhatsappReplyService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly secrets: SecretsService,
    private readonly redis: RedisService,
    private readonly uazapi: UazapiService,
  ) {}

  async reply(
    tenantId: string,
    userId: string,
    ticketId: string,
    content: string,
  ) {
    const { data: ticket, error: tErr } = await this.supabase.client
      .from('tickets')
      .select('id, tenant_id, channel, contact_id, contacts(phone,name)')
      .eq('id', ticketId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!ticket) throw new NotFoundException('Ticket não encontrado');
    if (ticket.channel !== 'whatsapp')
      throw new BadRequestException('Ticket não é de origem WhatsApp');

    const phone = (
      ticket as unknown as { contacts?: { phone?: string | null } | null }
    ).contacts?.phone;
    if (!phone) throw new BadRequestException('Contato sem número de telefone');

    const { data: tenant } = await this.supabase.client
      .from('tenants')
      .select(
        'whatsapp_enabled, whatsapp_uazapi_base_url, whatsapp_uazapi_token',
      )
      .eq('id', tenantId)
      .maybeSingle();
    if (
      !tenant?.whatsapp_enabled ||
      !tenant.whatsapp_uazapi_base_url ||
      !tenant.whatsapp_uazapi_token
    ) {
      throw new BadRequestException(
        'WhatsApp não configurado para este tenant',
      );
    }

    const rate = await this.redis.checkRateLimit(
      `whatsapp:send:${tenantId}`,
      SEND_RATE_LIMIT,
      SEND_RATE_WINDOW_SECONDS,
    );
    if (!rate.allowed) {
      throw new HttpException(
        `Limite de envio atingido, tente novamente em ${rate.retryAfterSeconds}s.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const token = this.secrets.decrypt(tenant.whatsapp_uazapi_token);
    let deliveryStatus: 'sent' | 'failed' = 'failed';
    let externalId: string | null = null;
    let lastErr: string | null = null;

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const r = await this.uazapi.sendText(
        tenant.whatsapp_uazapi_base_url,
        token,
        phone,
        content,
      );
      if (r.ok) {
        deliveryStatus = 'sent';
        const b = (r.body ?? {}) as Record<string, unknown>;
        externalId =
          (b.messageid as string | undefined) ??
          (b.id as string | undefined) ??
          ((b.message as Record<string, unknown> | undefined)?.id as
            string | undefined) ??
          null;
        break;
      }
      lastErr = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
      if (r.status === 429 || r.status >= 500) {
        await new Promise((res) => setTimeout(res, 500 * attempt));
        continue;
      }
      break;
    }

    const { data: inserted, error: msgErr } = await this.supabase.client
      .from('messages')
      .insert({
        tenant_id: tenantId,
        ticket_id: ticket.id,
        author_id: userId,
        author_type: 'agent',
        channel: 'whatsapp',
        is_internal: false,
        content,
        external_id: externalId,
        delivery_status: deliveryStatus,
      })
      .select('id')
      .single();
    if (msgErr) throw msgErr;

    if (deliveryStatus === 'failed') {
      throw new BadRequestException(
        `Falha ao enviar WhatsApp: ${lastErr ?? 'erro desconhecido'}`,
      );
    }
    return { ok: true as const, messageId: inserted.id };
  }

  async replyMedia(
    tenantId: string,
    userId: string,
    data: WhatsappSendMediaDto,
  ) {
    const { data: ticket, error: ticketError } = await this.supabase.client
      .from('tickets')
      .select('id, tenant_id, channel, contacts(phone)')
      .eq('id', data.ticketId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (ticketError) throw ticketError;
    if (!ticket) throw new NotFoundException('Ticket nÃ£o encontrado');
    if (ticket.channel !== 'whatsapp') {
      throw new BadRequestException('Ticket nÃ£o Ã© de origem WhatsApp');
    }
    const phone = (
      ticket as unknown as { contacts?: { phone?: string | null } | null }
    ).contacts?.phone;
    if (!phone)
      throw new BadRequestException('Contato sem nÃºmero de telefone');
    if (!data.path.startsWith(`${tenantId}/${ticket.id}/`)) {
      throw new BadRequestException('Caminho de anexo invÃ¡lido');
    }

    const supported =
      data.mimetype.startsWith('image/') ||
      data.mimetype.startsWith('audio/') ||
      data.mimetype.startsWith('video/') ||
      data.mimetype === 'application/pdf' ||
      data.mimetype === 'application/msword' ||
      data.mimetype.includes('officedocument') ||
      data.mimetype === 'text/plain' ||
      data.mimetype === 'application/zip';
    if (!supported) {
      throw new BadRequestException(
        `Tipo de arquivo nÃ£o suportado no WhatsApp: ${data.mimetype}`,
      );
    }

    const { data: tenant } = await this.supabase.client
      .from('tenants')
      .select(
        'whatsapp_enabled, whatsapp_uazapi_base_url, whatsapp_uazapi_token',
      )
      .eq('id', tenantId)
      .maybeSingle();
    if (
      !tenant?.whatsapp_enabled ||
      !tenant.whatsapp_uazapi_base_url ||
      !tenant.whatsapp_uazapi_token
    ) {
      throw new BadRequestException(
        'WhatsApp nÃ£o configurado para este tenant',
      );
    }

    const kind = data.mimetype.startsWith('image/')
      ? 'image'
      : data.mimetype.startsWith('audio/')
        ? data.mimetype.includes('webm') || data.filename.startsWith('audio-')
          ? 'ptt'
          : 'audio'
        : data.mimetype.startsWith('video/')
          ? 'video'
          : 'document';
    const token = this.secrets.decrypt(tenant.whatsapp_uazapi_token);
    const response = await this.uazapi.sendMedia(
      tenant.whatsapp_uazapi_base_url,
      token,
      {
        number: phone,
        type: kind,
        file: data.url,
        text: data.caption,
        docName: kind === 'document' ? data.filename : undefined,
        mimetype: data.mimetype,
      },
    );
    const body = (response.body ?? {}) as Record<string, unknown>;
    const externalId =
      (body.messageid as string | undefined) ??
      (body.id as string | undefined) ??
      ((body.message as Record<string, unknown> | undefined)?.id as
        string | undefined) ??
      null;
    const deliveryError = response.ok
      ? null
      : typeof response.body === 'string'
        ? response.body
        : JSON.stringify(response.body);

    const { data: inserted, error: insertError } = await this.supabase.client
      .from('messages')
      .insert({
        tenant_id: tenantId,
        ticket_id: ticket.id,
        author_id: userId,
        author_type: 'agent',
        channel: 'whatsapp',
        is_internal: false,
        content: data.caption || `[${kind}] ${data.filename}`,
        external_id: externalId,
        delivery_status: response.ok ? 'sent' : 'failed',
        delivery_attempts: 1,
        delivery_error: deliveryError,
        attachments: [
          {
            path: data.path,
            name: data.filename,
            size: data.size,
            type: data.mimetype,
          },
        ],
      })
      .select('id')
      .single();
    if (insertError) throw insertError;
    if (!response.ok) {
      throw new BadRequestException(`Falha ao enviar mÃ­dia: ${deliveryError}`);
    }
    return { ok: true as const, messageId: inserted.id, externalId };
  }
}
