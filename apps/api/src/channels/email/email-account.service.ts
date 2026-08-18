import { Injectable, NotFoundException } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { SupabaseService } from '../../supabase/supabase.service';
import { SecretsService } from '../../crypto/secrets.service';
import { EmailSchedulerService } from './email-scheduler.service';
import type { UpsertEmailAccountDto } from './dto/upsert-email-account.dto';
import type {
  EmailAccountDto,
  TestConnectionResultDto,
} from '@apticket/shared-types';

@Injectable()
export class EmailAccountService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly secrets: SecretsService,
    private readonly scheduler: EmailSchedulerService,
  ) {}

  async get(tenantId: string): Promise<EmailAccountDto | null> {
    const { data, error } = await this.supabase.client
      .from('tenants')
      .select(
        'id, email_imap_host, email_imap_port, email_imap_user, email_imap_secure, email_smtp_host, email_smtp_port, email_smtp_secure, email_poll_interval_minutes, email_enabled, email_last_polled_at',
      )
      .eq('id', tenantId)
      .maybeSingle();
    if (error || !data) return null;
    if (!data.email_imap_host) return null;
    return {
      tenantId: data.id,
      imapHost: data.email_imap_host,
      imapPort: data.email_imap_port,
      imapUser: data.email_imap_user,
      imapSecure: data.email_imap_secure,
      smtpHost: data.email_smtp_host,
      smtpPort: data.email_smtp_port,
      smtpSecure: data.email_smtp_secure,
      pollIntervalMinutes: data.email_poll_interval_minutes,
      enabled: data.email_enabled,
      lastPolledAt: data.email_last_polled_at,
    };
  }

  async upsert(
    tenantId: string,
    dto: UpsertEmailAccountDto,
  ): Promise<EmailAccountDto> {
    const { error } = await this.supabase.client
      .from('tenants')
      .update({
        email_imap_host: dto.imapHost,
        email_imap_port: dto.imapPort,
        email_imap_user: dto.imapUser,
        email_imap_password: this.secrets.encrypt(dto.imapPassword),
        email_imap_secure: dto.imapSecure,
        email_smtp_host: dto.smtpHost,
        email_smtp_port: dto.smtpPort,
        email_smtp_secure: dto.smtpSecure,
        email_poll_interval_minutes: dto.pollIntervalMinutes,
        email_enabled: dto.enabled,
      })
      .eq('id', tenantId);
    if (error) throw error;

    if (dto.enabled)
      await this.scheduler.schedule(tenantId, dto.pollIntervalMinutes);
    else await this.scheduler.unschedule(tenantId);

    const account = await this.get(tenantId);
    if (!account) throw new NotFoundException('Tenant não encontrado');
    return account;
  }

  async remove(tenantId: string): Promise<void> {
    await this.scheduler.unschedule(tenantId);
    const { error } = await this.supabase.client
      .from('tenants')
      .update({
        email_imap_host: null,
        email_imap_user: null,
        email_imap_password: null,
        email_smtp_host: null,
        email_enabled: false,
      })
      .eq('id', tenantId);
    if (error) throw error;
  }

  /** Testa com valores enviados na hora (antes de salvar) ou os já salvos. */
  async testConnection(
    tenantId: string,
    override?: Partial<
      Pick<
        UpsertEmailAccountDto,
        'imapHost' | 'imapPort' | 'imapUser' | 'imapPassword' | 'imapSecure'
      >
    >,
  ): Promise<TestConnectionResultDto> {
    let host = override?.imapHost;
    let port = override?.imapPort;
    let user = override?.imapUser;
    let password = override?.imapPassword;
    let secure = override?.imapSecure;

    if (!host || !user || !password) {
      const { data: t } = await this.supabase.client
        .from('tenants')
        .select(
          'email_imap_host, email_imap_port, email_imap_user, email_imap_password, email_imap_secure',
        )
        .eq('id', tenantId)
        .maybeSingle();
      host = host ?? t?.email_imap_host ?? undefined;
      port = port ?? t?.email_imap_port ?? undefined;
      user = user ?? t?.email_imap_user ?? undefined;
      password =
        password ??
        (t?.email_imap_password
          ? this.secrets.decrypt(t.email_imap_password)
          : undefined);
      secure = secure ?? t?.email_imap_secure ?? undefined;
    }
    if (!host || !user || !password) {
      return {
        imapOk: false,
        smtpOk: false,
        error: 'Informe servidor, usuário e senha.',
      };
    }

    const client = new ImapFlow({
      host,
      port: port ?? 993,
      secure: secure ?? true,
      auth: { user, pass: password },
      logger: false,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
    });

    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        await client.status('INBOX', { messages: true, unseen: true });
        return { imapOk: true, smtpOk: false };
      } finally {
        lock.release();
      }
    } catch (err) {
      return {
        imapOk: false,
        smtpOk: false,
        error: err instanceof Error ? err.message : 'Falha ao conectar.',
      };
    } finally {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    }
  }
}
