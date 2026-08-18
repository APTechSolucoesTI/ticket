import { Injectable, Logger } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { SupabaseService } from '../../supabase/supabase.service';
import { SecretsService } from '../../crypto/secrets.service';
import { EmailChannelService } from './email-channel.service';

// Portado de apps/web/src/lib/imap-poll.server.ts. Antes disparado por
// pg_cron a cada minuto batendo num endpoint HTTP; agora é um job repetível
// do BullMQ por tenant (ver EmailPollingProcessor), então cada conta roda no
// seu próprio intervalo sem depender de um cron externo.

export type TenantMailbox = {
  id: string;
  email_imap_host: string;
  email_imap_port: number;
  email_imap_user: string;
  email_imap_password: string; // já descriptografada
  email_imap_secure: boolean;
};

export type TenantPollResult = {
  tenant_id: string;
  processed: number;
  created: number;
  skipped: number;
  duplicates: number;
  errors: string[];
};

const MAX_MESSAGES_PER_POLL = 50;
const CONNECT_TIMEOUT_MS = 15_000;

@Injectable()
export class EmailPollingService {
  private readonly logger = new Logger(EmailPollingService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly secrets: SecretsService,
    private readonly emailChannel: EmailChannelService,
  ) {}

  async pollTenantMailbox(tenant: TenantMailbox): Promise<TenantPollResult> {
    const result: TenantPollResult = {
      tenant_id: tenant.id,
      processed: 0,
      created: 0,
      skipped: 0,
      duplicates: 0,
      errors: [],
    };

    const client = new ImapFlow({
      host: tenant.email_imap_host,
      port: tenant.email_imap_port,
      secure: tenant.email_imap_secure,
      auth: { user: tenant.email_imap_user, pass: tenant.email_imap_password },
      logger: false,
      connectionTimeout: CONNECT_TIMEOUT_MS,
      greetingTimeout: CONNECT_TIMEOUT_MS,
    });

    try {
      await client.connect();
    } catch (err) {
      result.errors.push(
        `connect_failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return result;
    }

    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const uids = await client.search({ seen: false }, { uid: true });
        const batch = (uids || []).slice(0, MAX_MESSAGES_PER_POLL);

        for (const uid of batch) {
          try {
            const msg = await client.fetchOne(
              String(uid),
              { source: true, uid: true },
              { uid: true },
            );
            if (!msg || !msg.source) continue;

            const parsed = await simpleParser(msg.source);
            const fromAddress = parsed.from?.value?.[0]?.address;
            if (!fromAddress) continue;

            const messageId = parsed.messageId || `imap-${tenant.id}-${uid}`;
            const attachments = (parsed.attachments ?? []).map((a) => ({
              filename: a.filename || `anexo-${Date.now()}`,
              contentType: a.contentType || 'application/octet-stream',
              size: a.size ?? a.content.length,
              content: a.content,
            }));
            const outcome = await this.emailChannel.processInboundEmail({
              message_id: messageId,
              from_email: fromAddress,
              from_name: parsed.from?.value?.[0]?.name ?? null,
              subject: parsed.subject || '(sem assunto)',
              body: parsed.text || parsed.html || '',
              tenant_id: tenant.id,
              attachments,
            });

            result.processed += 1;
            if (outcome.status === 'created') result.created += 1;
            else if (outcome.status === 'duplicate') result.duplicates += 1;
            else if (outcome.status === 'skipped') result.skipped += 1;
            else result.errors.push(`uid ${uid}: ${outcome.reason}`);

            if (outcome.status !== 'error') {
              await client.messageFlagsAdd(String(uid), ['\\Seen'], {
                uid: true,
              });
            }
          } catch (err) {
            result.errors.push(
              `uid ${uid}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      } finally {
        lock.release();
      }
    } catch (err) {
      result.errors.push(
        `mailbox_error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    }

    return result;
  }

  /** Usado pelo processor (job repetível) e pelo endpoint de sync manual. */
  async pollTenant(tenantId: string): Promise<TenantPollResult> {
    const { data: tenant, error } = await this.supabase.client
      .from('tenants')
      .select(
        'id, email_imap_host, email_imap_port, email_imap_user, email_imap_password, email_imap_secure',
      )
      .eq('id', tenantId)
      .maybeSingle();

    if (
      error ||
      !tenant?.email_imap_host ||
      !tenant.email_imap_user ||
      !tenant.email_imap_password
    ) {
      this.logger.warn(
        `tenant ${tenantId} has no usable IMAP config, skipping poll`,
      );
      return {
        tenant_id: tenantId,
        processed: 0,
        created: 0,
        skipped: 0,
        duplicates: 0,
        errors: [],
      };
    }

    const result = await this.pollTenantMailbox({
      id: tenant.id,
      email_imap_host: tenant.email_imap_host,
      email_imap_port: tenant.email_imap_port,
      email_imap_user: tenant.email_imap_user,
      email_imap_password: this.secrets.decrypt(tenant.email_imap_password),
      email_imap_secure: tenant.email_imap_secure,
    });

    await this.supabase.client
      .from('tenants')
      .update({ email_last_polled_at: new Date().toISOString() })
      .eq('id', tenant.id);

    return result;
  }
}
