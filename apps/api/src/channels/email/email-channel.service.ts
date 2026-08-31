import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SupabaseService } from '../../supabase/supabase.service';

// Portado 1:1 de apps/web/src/lib/email-channel.server.ts (mesma regra de
// negócio: remetentes autorizados viram tickets; sem contrato vigente, o
// banco classifica o atendimento como avulso. O frontend não faz mais essa
// gravação direta - só a API, com a service_role key.

export type InboundEmailAttachment = {
  filename: string;
  contentType: string;
  size: number;
  content: Buffer;
};
export type StoredAttachment = {
  path: string;
  name: string;
  size: number;
  type: string;
};

export type InboundEmail = {
  message_id: string;
  from_email: string;
  from_name?: string | null;
  subject: string;
  body: string;
  in_reply_to?: string | null;
  references?: string[];
  tenant_id?: string;
  attachments?: InboundEmailAttachment[];
};

export type InboundEmailResult =
  | { status: 'created'; ticket_id: string; number: number }
  | { status: 'duplicate'; ticket_id: string | null }
  | {
      status: 'skipped';
      reason: 'unknown_contact' | 'contact_not_allowed';
    }
  | { status: 'error'; reason: string };

@Injectable()
export class EmailChannelService {
  private readonly logger = new Logger(EmailChannelService.name);

  constructor(private readonly supabase: SupabaseService) {}

  private async uploadAttachments(
    basePath: string,
    attachments: InboundEmailAttachment[],
  ): Promise<StoredAttachment[]> {
    const uploaded: StoredAttachment[] = [];
    for (const att of attachments) {
      const safeName = (att.filename || 'anexo')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 120);
      const path = `${basePath}/${Date.now()}-${randomUUID()}-${safeName}`;
      const { error } = await this.supabase.client.storage
        .from('ticket-attachments')
        .upload(path, att.content, {
          contentType: att.contentType || 'application/octet-stream',
          upsert: false,
        });
      if (error) {
        this.logger.error(`attachment upload failed: ${error.message}`);
        continue;
      }
      uploaded.push({
        path,
        name: att.filename || safeName,
        size: att.size,
        type: att.contentType || 'application/octet-stream',
      });
    }
    return uploaded;
  }

  private async queuePendingEmail(params: {
    tenantId: string;
    contactId: string;
    data: InboundEmail;
  }) {
    const id = randomUUID();
    const attachments = params.data.attachments?.length
      ? await this.uploadAttachments(
          `${params.tenantId}/pending/${id}`,
          params.data.attachments,
        )
      : [];

    const { error } = await this.supabase.client
      .from('email_pending_messages')
      .insert({
        id,
        tenant_id: params.tenantId,
        contact_id: params.contactId,
        from_email: params.data.from_email,
        from_name: params.data.from_name ?? null,
        subject: params.data.subject,
        content: params.data.body || '(sem conteúdo)',
        message_id: params.data.message_id,
        attachments,
      });
    if (error)
      this.logger.error(`pending queue insert error: ${error.message}`);
  }

  async processInboundEmail(data: InboundEmail): Promise<InboundEmailResult> {
    const { data: contact, error: contactErr } = await this.supabase.client
      .from('contacts')
      .select('id, tenant_id, company_id, name, can_open_tickets, is_active')
      .ilike('email', data.from_email)
      .maybeSingle();

    if (contactErr) {
      this.logger.error(`contact lookup error: ${contactErr.message}`);
      return { status: 'error', reason: 'db_error' };
    }

    if (!contact) {
      if (data.tenant_id) {
        const { data: newContact, error: cErr } = await this.supabase.client
          .from('contacts')
          .insert({
            tenant_id: data.tenant_id,
            company_id: null,
            name: data.from_name?.trim() || data.from_email,
            email: data.from_email,
            is_active: true,
            can_open_tickets: false,
            notes:
              'Contato criado automaticamente via e-mail - aguardando vínculo com cliente.',
          })
          .select('id')
          .single();
        if (cErr || !newContact) {
          this.logger.error(`create pending contact failed: ${cErr?.message}`);
        } else {
          await this.queuePendingEmail({
            tenantId: data.tenant_id,
            contactId: newContact.id,
            data,
          });
        }
      }
      return { status: 'skipped', reason: 'unknown_contact' };
    }

    if (!contact.company_id) {
      await this.queuePendingEmail({
        tenantId: contact.tenant_id,
        contactId: contact.id,
        data,
      });
      return { status: 'skipped', reason: 'unknown_contact' };
    }

    if (contact.is_active === false || contact.can_open_tickets === false) {
      return { status: 'skipped', reason: 'contact_not_allowed' };
    }

    const { data: contractRow } = await this.supabase.client
      .from('contracts')
      .select('id, sla_policy_id')
      .eq('tenant_id', contact.tenant_id)
      .eq('company_id', contact.company_id)
      .eq('status', 'active')
      .order('starts_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: existingMsg } = await this.supabase.client
      .from('messages')
      .select('id, ticket_id')
      .eq('tenant_id', contact.tenant_id)
      .eq('channel', 'email')
      .gte('created_at', since)
      .eq('external_id', data.message_id)
      .maybeSingle();

    if (existingMsg) {
      return { status: 'duplicate', ticket_id: existingMsg.ticket_id };
    }

    // Prefer RFC 5322 threading over the subject. Nodemailer stores its
    // Message-ID in messages.external_id, and replies return that value in
    // In-Reply-To/References. This keeps a customer's answer on the open
    // ticket instead of creating a new one with the same subject.
    const threadIds = Array.from(
      new Set(
        [data.in_reply_to, ...(data.references ?? [])].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    );
    if (threadIds.length > 0) {
      const { data: parentMessages } = await this.supabase.client
        .from('messages')
        .select('ticket_id')
        .eq('tenant_id', contact.tenant_id)
        .eq('channel', 'email')
        .in('external_id', threadIds)
        .order('created_at', { ascending: false })
        .limit(10);

      const candidateTicketIds = Array.from(
        new Set((parentMessages ?? []).map((message) => message.ticket_id)),
      );
      if (candidateTicketIds.length > 0) {
        const { data: openTicket } = await this.supabase.client
          .from('tickets')
          .select('id, number')
          .eq('tenant_id', contact.tenant_id)
          .eq('contact_id', contact.id)
          .eq('channel', 'email')
          .in('id', candidateTicketIds)
          .not('status', 'in', '(resolved,closed)')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (openTicket) {
          const attachments = data.attachments?.length
            ? await this.uploadAttachments(
                `${contact.tenant_id}/${openTicket.id}`,
                data.attachments,
              )
            : [];
          const { error: replyError } = await this.supabase.client
            .from('messages')
            .insert({
              tenant_id: contact.tenant_id,
              ticket_id: openTicket.id,
              author_contact_id: contact.id,
              author_type: 'contact',
              channel: 'email',
              is_internal: false,
              content: data.body || '(sem conteÃºdo)',
              external_id: data.message_id,
              attachments,
            });
          if (replyError) {
            this.logger.error(
              `threaded reply insert error: ${replyError.message}`,
            );
            return { status: 'error', reason: 'message_insert_failed' };
          }
          await this.supabase.client
            .from('tickets')
            .update({ status: 'in_progress', pending_type: 'awaiting_tech' })
            .eq('id', openTicket.id);
          return {
            status: 'created',
            ticket_id: openTicket.id,
            number: openTicket.number,
          };
        }
      }
    }

    const { data: ticket, error: ticketErr } = await this.supabase.client
      .from('tickets')
      .insert({
        tenant_id: contact.tenant_id,
        subject: data.subject,
        status: 'new',
        priority: 'medium',
        channel: 'email',
        contact_id: contact.id,
        company_id: contact.company_id,
        contract_id: contractRow?.id ?? null,
        sla_policy_id: contractRow?.sla_policy_id ?? null,
        pending_type: 'awaiting_tech',
      })
      .select('id, number')
      .single();

    if (ticketErr || !ticket) {
      this.logger.error(`ticket insert error: ${ticketErr?.message}`);
      return { status: 'error', reason: 'ticket_insert_failed' };
    }

    const attachments = data.attachments?.length
      ? await this.uploadAttachments(
          `${contact.tenant_id}/${ticket.id}`,
          data.attachments,
        )
      : [];

    const { error: msgErr } = await this.supabase.client
      .from('messages')
      .insert({
        tenant_id: contact.tenant_id,
        ticket_id: ticket.id,
        author_contact_id: contact.id,
        author_type: 'contact',
        channel: 'email',
        is_internal: false,
        content: data.body || '(sem conteúdo)',
        external_id: data.message_id,
        attachments,
      });
    if (msgErr) this.logger.error(`message insert error: ${msgErr.message}`);

    return { status: 'created', ticket_id: ticket.id, number: ticket.number };
  }
}
