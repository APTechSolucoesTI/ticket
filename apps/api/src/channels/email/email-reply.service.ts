import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { SecretsService } from '../../crypto/secrets.service';
import { EmailSenderService } from './email-sender.service';
import type { EmailReplyAttachmentDto } from './dto/send-email-reply.dto';

function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;
}

function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();
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
    attachments: EmailReplyAttachmentDto[] = [],
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

    const storedAttachments = attachments.map((attachment) => ({
      path: attachment.path,
      name: attachment.name,
      size: attachment.size,
      type: attachment.type,
    }));
    const { data: pendingMessage, error: pendingErr } =
      await this.supabase.client
        .from('messages')
        .insert({
          tenant_id: tenantId,
          ticket_id: ticket.id,
          author_id: userId,
          author_type: 'agent',
          channel: 'email',
          is_internal: false,
          content,
          attachments: storedAttachments,
          delivery_status: 'sending',
          delivery_attempts: 1,
        })
        .select('id')
        .single();
    if (pendingErr) throw pendingErr;

    try {
      const mailAttachments: Array<{
        filename: string;
        content: Buffer;
        contentType: string;
      }> = [];
      for (const attachment of attachments) {
        if (!attachment.path.startsWith(`${tenantId}/${ticket.id}/`)) {
          throw new Error(`Caminho de anexo invÃ¡lido: ${attachment.name}`);
        }
        const { data: blob, error: downloadError } =
          await this.supabase.client.storage
            .from('ticket-attachments')
            .download(attachment.path);
        if (downloadError || !blob) {
          throw new Error(
            `NÃ£o foi possÃ­vel carregar o anexo ${attachment.name}: ${downloadError?.message ?? 'arquivo ausente'}`,
          );
        }
        mailAttachments.push({
          filename: attachment.name,
          content: Buffer.from(await blob.arrayBuffer()),
          contentType: attachment.type || 'application/octet-stream',
        });
      }

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
          text: plainText(content),
          html: content,
          inReplyTo: lastInbound?.external_id ?? null,
          references: lastInbound?.external_id ?? null,
          attachments: mailAttachments,
        },
      );
      const { error: updateError } = await this.supabase.client
        .from('messages')
        .update({
          external_id: sent.messageId,
          delivery_status: 'sent',
          delivery_error: null,
        })
        .eq('id', pendingMessage.id);
      if (updateError) throw updateError;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.supabase.client
        .from('messages')
        .update({ delivery_status: 'failed', delivery_error: message })
        .eq('id', pendingMessage.id);
      throw new BadRequestException(`Falha ao enviar e-mail: ${message}`);
    }
    return { ok: true as const, messageId: pendingMessage.id };
  }
}
