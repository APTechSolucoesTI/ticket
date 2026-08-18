import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { SecretsService } from '../../crypto/secrets.service';
import { EmailSenderService } from './email-sender.service';

function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;
}

// Portado de sendEmailReply em apps/web/src/lib/email-channel.functions.ts.
@Injectable()
export class EmailReplyService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly secrets: SecretsService,
    private readonly sender: EmailSenderService,
  ) {}

  async reply(
    tenantId: string,
    userId: string,
    ticketId: string,
    content: string,
  ) {
    const { data: ticket, error: tErr } = await this.supabase.client
      .from('tickets')
      .select(
        'id, tenant_id, subject, channel, contact_id, contacts(email, name)',
      )
      .eq('id', ticketId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!ticket) throw new NotFoundException('Ticket não encontrado');
    if (ticket.channel !== 'email')
      throw new BadRequestException('Ticket não é de origem e-mail');

    const contactEmail = (
      ticket as unknown as { contacts?: { email?: string | null } | null }
    ).contacts?.email;
    if (!contactEmail)
      throw new BadRequestException('Contato sem e-mail cadastrado');

    const { data: tenant } = await this.supabase.client
      .from('tenants')
      .select(
        'name, email_imap_user, email_imap_password, email_smtp_host, email_smtp_port, email_smtp_secure',
      )
      .eq('id', tenantId)
      .maybeSingle();
    if (
      !tenant?.email_smtp_host ||
      !tenant.email_imap_user ||
      !tenant.email_imap_password
    ) {
      throw new BadRequestException(
        'Configure o envio (SMTP) em Configurações → Canais → E-mail antes de responder.',
      );
    }

    const { data: lastInbound } = await this.supabase.client
      .from('messages')
      .select('external_id')
      .eq('ticket_id', ticket.id)
      .eq('channel', 'email')
      .eq('author_type', 'contact')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let externalId: string | null = null;
    try {
      const sent = await this.sender.sendTenantEmail(
        {
          host: tenant.email_smtp_host,
          port: tenant.email_smtp_port,
          secure: tenant.email_smtp_secure,
          user: tenant.email_imap_user,
          password: this.secrets.decrypt(tenant.email_imap_password),
          fromName: tenant.name,
        },
        {
          to: contactEmail,
          subject: replySubject(ticket.subject),
          text: content,
          inReplyTo: lastInbound?.external_id ?? null,
          references: lastInbound?.external_id ?? null,
        },
      );
      externalId = sent.messageId;
    } catch (err) {
      throw new BadRequestException(
        `Falha ao enviar e-mail: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const { data: inserted, error: msgErr } = await this.supabase.client
      .from('messages')
      .insert({
        tenant_id: tenantId,
        ticket_id: ticket.id,
        author_id: userId,
        author_type: 'agent',
        channel: 'email',
        is_internal: false,
        content,
        external_id: externalId,
      })
      .select('id')
      .single();
    if (msgErr) throw msgErr;

    return { ok: true as const, messageId: inserted.id };
  }
}
