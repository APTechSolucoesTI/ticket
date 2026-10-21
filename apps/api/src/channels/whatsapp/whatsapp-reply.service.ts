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
import type { Json } from '@apticket/shared-types/database';
import type {
  WhatsappCallDto,
  WhatsappSendContactDto,
  WhatsappSendLocationDto,
  WhatsappSendMediaDto,
  WhatsappSendStickerDto,
} from './dto/whatsapp-send-message.dto';

// Portado de sendWhatsAppReply em apps/web/src/lib/whatsapp.functions.ts.
// Diferença: token da uazapi agora vem criptografado do banco, e o envio
// passa por um rate limit no Redis antes de chamar a uazapi (evita bloqueio
// do número por excesso de chamadas - pedido explícito do prompt).
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

  private async context(tenantId: string, ticketId: string) {
    const { data: ticket, error } = await this.supabase.client
      .from('tickets')
      .select('id, tenant_id, channel, contacts(phone,name)')
      .eq('id', ticketId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!ticket) throw new NotFoundException('Ticket não encontrado');
    if (ticket.channel !== 'whatsapp')
      throw new BadRequestException('Ticket não é de origem WhatsApp');
    const phone = (
      ticket as unknown as { contacts?: { phone?: string | null } | null }
    ).contacts?.phone;
    if (!phone) throw new BadRequestException('Contato sem número de telefone');
    const { data: tenant, error: tenantError } = await this.supabase.client
      .from('tenants')
      .select(
        'whatsapp_enabled, whatsapp_uazapi_base_url, whatsapp_uazapi_token',
      )
      .eq('id', tenantId)
      .maybeSingle();
    if (tenantError) throw tenantError;
    if (
      !tenant?.whatsapp_enabled ||
      !tenant.whatsapp_uazapi_base_url ||
      !tenant.whatsapp_uazapi_token
    )
      throw new BadRequestException(
        'WhatsApp não configurado para este tenant',
      );
    const rate = await this.redis.checkRateLimit(
      `whatsapp:send:${tenantId}`,
      SEND_RATE_LIMIT,
      SEND_RATE_WINDOW_SECONDS,
    );
    if (!rate.allowed)
      throw new HttpException(
        `Limite de envio atingido, tente novamente em ${rate.retryAfterSeconds}s.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    return {
      ticket,
      phone,
      baseUrl: tenant.whatsapp_uazapi_base_url,
      token: this.secrets.decrypt(tenant.whatsapp_uazapi_token),
    };
  }

  private responseDetails(response: { ok: boolean; body: unknown }) {
    const body = (response.body ?? {}) as Record<string, unknown>;
    return {
      externalId:
        (body.messageid as string | undefined) ??
        (body.id as string | undefined) ??
        ((body.message as Record<string, unknown> | undefined)?.id as
          string | undefined) ??
        null,
      error: response.ok
        ? null
        : typeof response.body === 'string'
          ? response.body
          : JSON.stringify(response.body),
    };
  }

  private async persistSpecial(
    tenantId: string,
    userId: string,
    ticketId: string,
    content: string,
    response: { ok: boolean; body: unknown },
    attachments: Json[] = [],
  ) {
    const details = this.responseDetails(response);
    const { data, error } = await this.supabase.client
      .from('messages')
      .insert({
        tenant_id: tenantId,
        ticket_id: ticketId,
        author_id: userId,
        author_type: 'agent',
        channel: 'whatsapp',
        is_internal: false,
        content,
        external_id: details.externalId,
        delivery_status: response.ok ? 'sent' : 'failed',
        delivery_attempts: 1,
        delivery_error: details.error,
        attachments,
      })
      .select('id')
      .single();
    if (error) throw error;
    if (!response.ok)
      throw new BadRequestException(
        `Falha UAZAPI: ${details.error ?? 'erro desconhecido'}`,
      );
    return {
      ok: true as const,
      messageId: data.id,
      externalId: details.externalId,
    };
  }

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

  // Persist before signing/sending: the database binds the object to this ticket
  // and refuses private/foreign attachments before any external side effect.
  private async sendStoredMedia(
    tenantId: string,
    userId: string,
    ctx: Awaited<ReturnType<WhatsappReplyService['context']>>,
    file: {
      path: string;
      filename: string;
      mimetype: string;
      size: number;
      caption?: string;
    },
    kind: 'image' | 'audio' | 'video' | 'document' | 'ptt' | 'sticker',
  ) {
    const path = file.path;
    const scoped =
      path.startsWith(tenantId + '/' + ctx.ticket.id + '/') ||
      (kind === 'sticker' && path.startsWith(tenantId + '/_stickers/'));
    if (
      !scoped ||
      /(^|\/)[.][.]?(\/|$)|[%?#\\]/.test(path) ||
      [...path].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      path.includes('//')
    ) {
      throw new BadRequestException('Caminho de anexo inválido');
    }
    const { data: pending, error: insertError } = await this.supabase.client
      .from('messages')
      .insert({
        tenant_id: tenantId,
        ticket_id: ctx.ticket.id,
        author_id: userId,
        author_type: 'agent',
        channel: 'whatsapp',
        is_internal: false,
        content:
          file.caption ||
          (kind === 'sticker'
            ? 'Figurinha'
            : '[' + kind + '] ' + file.filename),
        delivery_status: 'sending',
        delivery_attempts: 1,
        attachments: [
          {
            path,
            name: file.filename,
            size: file.size,
            type: file.mimetype,
            ...(kind === 'sticker' ? { kind } : {}),
          },
        ],
      })
      .select('id')
      .single();
    if (insertError) throw insertError;
    try {
      // A browser-provided URL is never forwarded to the provider. Generate a
      // short-lived capability for exactly the object validated by the insert.
      const { data: signed, error: signError } =
        await this.supabase.client.storage
          .from('ticket-attachments')
          .createSignedUrl(path, 120);
      if (signError || !signed?.signedUrl)
        throw new Error('Não foi possível carregar o anexo');
      const response = await this.uazapi.sendMedia(ctx.baseUrl, ctx.token, {
        number: ctx.phone,
        type: kind,
        file: signed.signedUrl,
        text: file.caption,
        docName: kind === 'document' ? file.filename : undefined,
        mimetype: file.mimetype,
      });
      const details = this.responseDetails(response);
      const { error: updateError } = await this.supabase.client
        .from('messages')
        .update({
          external_id: details.externalId,
          delivery_status: response.ok ? 'sent' : 'failed',
          delivery_error: details.error,
        })
        .eq('id', pending.id)
        .eq('tenant_id', tenantId);
      if (updateError) throw updateError;
      if (!response.ok) throw new Error(details.error ?? 'Falha UAZAPI');
      return {
        ok: true as const,
        messageId: pending.id,
        externalId: details.externalId,
      };
    } catch (error) {
      await this.supabase.client
        .from('messages')
        .update({
          delivery_status: 'failed',
          delivery_error: 'Falha ao enviar mídia',
        })
        .eq('id', pending.id)
        .eq('tenant_id', tenantId);
      throw error;
    }
  }

  async replyMedia(
    tenantId: string,
    userId: string,
    data: WhatsappSendMediaDto,
  ) {
    const supported =
      data.mimetype.startsWith('image/') ||
      data.mimetype.startsWith('audio/') ||
      data.mimetype.startsWith('video/') ||
      data.mimetype === 'application/pdf' ||
      data.mimetype === 'application/msword' ||
      data.mimetype.includes('officedocument') ||
      data.mimetype === 'text/plain' ||
      data.mimetype === 'application/zip';
    if (!supported)
      throw new BadRequestException(
        'Tipo de arquivo não suportado no WhatsApp: ' + data.mimetype,
      );
    const ctx = await this.context(tenantId, data.ticketId);
    const kind = data.mimetype.startsWith('image/')
      ? 'image'
      : data.mimetype.startsWith('audio/')
        ? data.mimetype.includes('webm') || data.filename.startsWith('audio-')
          ? 'ptt'
          : 'audio'
        : data.mimetype.startsWith('video/')
          ? 'video'
          : 'document';
    return this.sendStoredMedia(tenantId, userId, ctx, data, kind);
  }

  async replyContact(
    tenantId: string,
    userId: string,
    data: WhatsappSendContactDto,
  ) {
    const ctx = await this.context(tenantId, data.ticketId);
    const response = await this.uazapi.sendContact(
      ctx.baseUrl,
      ctx.token,
      ctx.phone,
      {
        name: data.name,
        phone: data.phone,
      },
    );
    return this.persistSpecial(
      tenantId,
      userId,
      ctx.ticket.id,
      `Contato: ${data.name}`,
      response,
      [
        {
          path: '',
          name: data.name,
          size: 0,
          type: 'application/vnd.apticket.whatsapp-contact+json',
          kind: 'contact',
          contact: { name: data.name, phone: data.phone },
        },
      ],
    );
  }

  async replyLocation(
    tenantId: string,
    userId: string,
    data: WhatsappSendLocationDto,
  ) {
    const ctx = await this.context(tenantId, data.ticketId);
    const response = await this.uazapi.sendLocation(ctx.baseUrl, ctx.token, {
      number: ctx.phone,
      latitude: data.latitude,
      longitude: data.longitude,
      name: data.name,
      address: data.address,
    });
    return this.persistSpecial(
      tenantId,
      userId,
      ctx.ticket.id,
      data.name ? `Localização: ${data.name}` : 'Localização compartilhada',
      response,
      [
        {
          path: '',
          name: data.name ?? 'Localização',
          size: 0,
          type: 'application/vnd.apticket.whatsapp-location+json',
          kind: 'location',
          location: {
            latitude: data.latitude,
            longitude: data.longitude,
            name: data.name,
            address: data.address,
          },
        },
      ],
    );
  }

  async replySticker(
    tenantId: string,
    userId: string,
    data: WhatsappSendStickerDto,
  ) {
    const ctx = await this.context(tenantId, data.ticketId);
    return this.sendStoredMedia(
      tenantId,
      userId,
      ctx,
      { ...data, mimetype: 'image/webp', size: 0 },
      'sticker',
    );
  }

  async call(tenantId: string, userId: string, data: WhatsappCallDto) {
    const ctx = await this.context(tenantId, data.ticketId);
    const duration = data.duration ?? 15;
    const response = await this.uazapi.makeCall(
      ctx.baseUrl,
      ctx.token,
      ctx.phone,
      duration,
    );
    return this.persistSpecial(
      tenantId,
      userId,
      ctx.ticket.id,
      `Ligação WhatsApp iniciada (${duration}s)`,
      response,
    );
  }
}
