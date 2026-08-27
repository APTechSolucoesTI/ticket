import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SupabaseService } from '../../supabase/supabase.service';
import { RedisService } from '../../queue/redis.service';
import {
  asRecord,
  extractExternalId,
  extractName,
  extractPhone,
  extractStructuredAttachments,
  extractText,
  firstRecord,
  isFromMe,
  normalizeStatus,
  sanitizeWebhookPayload,
  samePhone,
  type UnknownRec,
  type WhatsappStructuredAttachment,
} from './whatsapp-parser.util';

const DEDUP_TTL_SECONDS = 6 * 60 * 60; // 6h — cobre picos de reentrega da uazapi
const MAX_INBOUND_MEDIA_BYTES = 25 * 1024 * 1024;

export type WhatsappWebhookOutcome =
  | { kind: 'status' }
  | { kind: 'connection' }
  | { kind: 'ignored'; reason: string }
  | { kind: 'duplicate'; ticketId?: string | null; pendingId?: string | null }
  | {
      kind: 'pending';
      reason: string;
      contactId: string;
      pendingId?: string | null;
    }
  | { kind: 'ticket'; ticketId: string };

// Portado do handler POST em
// apps/web/src/routes/api/public/hooks/uazapi/$tenantId.ts — a diferença é
// que aqui roda dentro do processor da fila `whatsapp-inbound`
// (WhatsappInboundProcessor), não direto no request HTTP, então falha
// transitória tem retry automático do BullMQ em vez de perder o evento.
@Injectable()
export class WhatsappWebhookService {
  private readonly logger = new Logger(WhatsappWebhookService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly redis: RedisService,
  ) {}

  async handle(
    tenantId: string,
    payload: UnknownRec,
  ): Promise<WhatsappWebhookOutcome> {
    const rawEvent = payload.event ?? payload.type ?? payload.EventType;
    const eventType = (
      typeof rawEvent === 'string' ? rawEvent : ''
    ).toLowerCase();

    if (eventType.includes('status') || eventType.includes('ack')) {
      const extId = extractExternalId(payload);
      const status = normalizeStatus(payload.status ?? payload.ack);
      if (extId && status) {
        await this.supabase.client
          .from('messages')
          .update({ delivery_status: status })
          .eq('tenant_id', tenantId)
          .eq('external_id', extId);
      }
      return { kind: 'status' };
    }

    if (
      eventType.includes('connect') ||
      eventType.includes('qr') ||
      eventType.includes('disconnect')
    ) {
      this.logger.log(`connection event tenant=${tenantId} type=${eventType}`);
      return { kind: 'connection' };
    }

    if (isFromMe(payload)) return { kind: 'ignored', reason: 'from_me' };

    const messageObj =
      firstRecord(payload.messages) ??
      asRecord(payload.message) ??
      asRecord(payload.data) ??
      payload;
    const phone = extractPhone(payload);
    const text = extractText(payload);
    const extId = extractExternalId(payload);
    const pushName = extractName(payload);
    const extractedAttachments = extractStructuredAttachments(
      payload,
      messageObj,
    );
    const hasAttachment = extractedAttachments.length > 0;
    const hasStructuredCard = extractedAttachments.some(
      (attachment) =>
        attachment.kind === 'contact' ||
        attachment.kind === 'location' ||
        attachment.kind === 'sticker',
    );
    const content = hasStructuredCard
      ? attachmentDescription(extractedAttachments)
      : text || attachmentDescription(extractedAttachments);

    if (!phone || (!text && !hasAttachment)) {
      return { kind: 'ignored', reason: 'no_content' };
    }

    // Dedup rápido via Redis (idempotência de reentrega de webhook) — a
    // checagem definitiva por external_id no Postgres continua abaixo,
    // esse SETNX só evita processar duas vezes em paralelo/picos.
    if (extId) {
      const isNew = await this.redis.setIfNotExists(
        `whatsapp:dedup:${tenantId}:${extId}`,
        DEDUP_TTL_SECONDS,
      );
      if (!isNew) return { kind: 'duplicate' };

      const [{ data: existingMessage }, { data: existingPending }] =
        await Promise.all([
          this.supabase.client
            .from('messages')
            .select('id, ticket_id')
            .eq('tenant_id', tenantId)
            .eq('external_id', extId)
            .maybeSingle(),
          this.supabase.client
            .from('whatsapp_pending_messages')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('external_id', extId)
            .maybeSingle(),
        ]);
      if (existingMessage?.ticket_id)
        return { kind: 'duplicate', ticketId: existingMessage.ticket_id };
      if (existingPending?.id)
        return { kind: 'duplicate', pendingId: existingPending.id };
    }

    // A UAZAPI entrega mídia por URL temporária do mmg.whatsapp.net. Copiar
    // agora evita anexos quebrados quando o usuário abre o ticket depois.
    const attachments = await this.persistInboundAttachments(
      tenantId,
      extId,
      extractedAttachments,
    );

    const { data: contactMatches } = await this.supabase.client
      .from('contacts')
      .select(
        'id, tenant_id, company_id, name, phone, can_open_tickets, is_active',
      )
      .eq('tenant_id', tenantId);

    let contact =
      (contactMatches ?? []).find((c) => samePhone(c.phone, phone)) ?? null;

    if (!contact) {
      const { data: newContact, error: cErr } = await this.supabase.client
        .from('contacts')
        .insert({
          tenant_id: tenantId,
          company_id: null,
          name: pushName || `WhatsApp ${phone}`,
          phone,
          email: null,
          is_active: true,
          can_open_tickets: false,
          notes:
            'Contato criado automaticamente via WhatsApp — aguardando vínculo com cliente.',
        })
        .select(
          'id, tenant_id, company_id, name, phone, can_open_tickets, is_active',
        )
        .single();
      if (cErr || !newContact) {
        this.logger.error(`create pending contact failed: ${cErr?.message}`);
        throw new Error('create_contact_failed');
      }
      contact = newContact;
    }

    if (!contact.company_id) {
      const pendingId = await this.queuePending(
        tenantId,
        contact.id,
        phone,
        content,
        extId,
        payload,
        attachments,
      );
      return {
        kind: 'pending',
        reason: 'contact_not_linked_to_company',
        contactId: contact.id,
        pendingId,
      };
    }

    if (contact.is_active === false || contact.can_open_tickets === false) {
      const pendingId = await this.queuePending(
        tenantId,
        contact.id,
        phone,
        content,
        extId,
        payload,
        attachments,
      );
      return {
        kind: 'pending',
        reason: 'contact_blocked',
        contactId: contact.id,
        pendingId,
      };
    }

    const { data: contracts } = await this.supabase.client
      .from('contracts')
      .select(
        'id, sla_policy_id, includes_remote, includes_lab, includes_onsite',
      )
      .eq('tenant_id', tenantId)
      .eq('company_id', contact.company_id)
      .eq('status', 'active')
      .order('starts_at', { ascending: false });

    const contract = (contracts ?? []).find(
      (c) => c.includes_remote || c.includes_lab || c.includes_onsite,
    );
    if (!contract) {
      const pendingId = await this.queuePending(
        tenantId,
        contact.id,
        phone,
        content,
        extId,
        payload,
        attachments,
      );
      return {
        kind: 'pending',
        reason: 'no_active_contract',
        contactId: contact.id,
        pendingId,
      };
    }

    const { data: openTickets } = await this.supabase.client
      .from('tickets')
      .select('id, status')
      .eq('tenant_id', tenantId)
      .eq('contact_id', contact.id)
      .eq('channel', 'whatsapp')
      .not('status', 'in', '(resolved,closed)')
      .order('created_at', { ascending: false })
      .limit(1);

    let ticketId = openTickets?.[0]?.id ?? null;
    if (!ticketId) {
      const subject = (content || 'Mensagem via WhatsApp').slice(0, 200);
      const { data: newT, error: tErr } = await this.supabase.client
        .from('tickets')
        .insert({
          tenant_id: tenantId,
          subject,
          status: 'new',
          priority: 'medium',
          channel: 'whatsapp',
          contact_id: contact.id,
          company_id: contact.company_id,
          contract_id: contract.id,
          sla_policy_id: contract.sla_policy_id ?? null,
          pending_type: 'awaiting_tech',
        })
        .select('id')
        .single();
      if (tErr || !newT) {
        this.logger.error(`create ticket failed: ${tErr?.message}`);
        throw new Error('create_ticket_failed');
      }
      ticketId = newT.id;
    }

    const { error: msgErr } = await this.supabase.client
      .from('messages')
      .insert({
        tenant_id: tenantId,
        ticket_id: ticketId,
        author_contact_id: contact.id,
        author_type: 'contact',
        channel: 'whatsapp',
        is_internal: false,
        content,
        external_id: extId,
        delivery_status: 'received',
        attachments,
      });
    if (msgErr) {
      this.logger.error(`insert message failed: ${msgErr.message}`);
      throw new Error('insert_message_failed');
    }

    return { kind: 'ticket', ticketId };
  }

  private async persistInboundAttachments(
    tenantId: string,
    externalId: string | null,
    attachments: WhatsappStructuredAttachment[],
  ): Promise<WhatsappStructuredAttachment[]> {
    return Promise.all(
      attachments.map(async (attachment, index) => {
        if (
          !attachment.url ||
          attachment.kind === 'contact' ||
          attachment.kind === 'location'
        ) {
          return attachment;
        }

        try {
          const response = await fetch(attachment.url, {
            redirect: 'follow',
            signal: AbortSignal.timeout(30_000),
          });
          if (!response.ok) {
            throw new Error(`download_http_${response.status}`);
          }

          const declaredSize = Number(response.headers.get('content-length'));
          if (
            Number.isFinite(declaredSize) &&
            declaredSize > MAX_INBOUND_MEDIA_BYTES
          ) {
            throw new Error('media_exceeds_25mb');
          }

          const body = await response.arrayBuffer();
          if (body.byteLength > MAX_INBOUND_MEDIA_BYTES) {
            throw new Error('media_exceeds_25mb');
          }

          const safeId = (externalId ?? randomUUID()).replace(
            /[^a-zA-Z0-9_-]/g,
            '_',
          );
          const safeName = attachment.name
            .normalize('NFKD')
            .replace(/[^a-zA-Z0-9._-]/g, '_')
            .slice(-120);
          const path = `${tenantId}/whatsapp-inbound/${safeId}-${index}-${safeName || 'anexo'}`;
          const contentType =
            response.headers.get('content-type')?.split(';')[0] ||
            attachment.type ||
            'application/octet-stream';
          const { error } = await this.supabase.client.storage
            .from('ticket-attachments')
            .upload(path, body, {
              contentType,
              upsert: false,
            });
          if (error) throw error;

          return {
            ...attachment,
            path,
            url: undefined,
            size: body.byteLength,
            type: contentType,
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `inbound media persistence failed tenant=${tenantId} external=${externalId ?? 'none'}: ${message}`,
          );
          return attachment;
        }
      }),
    );
  }

  private async queuePending(
    tenantId: string,
    contactId: string,
    phone: string,
    text: string,
    extId: string | null,
    payload: UnknownRec,
    attachments: ReturnType<typeof extractStructuredAttachments>,
  ) {
    const { data: pending, error } = await this.supabase.client
      .from('whatsapp_pending_messages')
      .insert({
        tenant_id: tenantId,
        contact_id: contactId,
        phone,
        content: text || '[anexo]',
        external_id: extId,
        payload: sanitizeWebhookPayload(payload) as never,
        attachments: attachments as never,
      })
      .select('id')
      .maybeSingle();
    if (error) this.logger.error(`pending insert failed: ${error.message}`);
    return pending?.id ?? null;
  }
}

function attachmentDescription(
  attachments: ReturnType<typeof extractStructuredAttachments>,
): string {
  const first = attachments[0];
  if (!first) return '[anexo]';
  if (first.kind === 'contact')
    return `Contato: ${first.contact?.name ?? first.name}`;
  if (first.kind === 'location')
    return `Localização: ${first.location?.name ?? first.name}`;
  if (first.kind === 'sticker') return 'Figurinha';
  if (first.type.startsWith('image/')) return 'Imagem recebida';
  if (first.type.startsWith('video/')) return 'Vídeo recebido';
  if (first.type.startsWith('audio/')) return 'Áudio recebido';
  return `Arquivo recebido: ${first.name}`;
}
