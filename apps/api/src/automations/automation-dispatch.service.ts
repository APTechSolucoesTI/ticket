import { Injectable } from '@nestjs/common';
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unnecessary-type-assertion -- tabelas da migration atual entram nos tipos gerados após o deploy */
import { ConfigService } from '@nestjs/config';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../supabase/supabase.service';
import { SecretsService } from '../crypto/secrets.service';
import { RedisService } from '../queue/redis.service';
import { UazapiService } from '../channels/whatsapp/uazapi.service';
import { EmailSenderService } from '../channels/email/email-sender.service';
import type { Env } from '../config/env.validation';
import type { AutomationDispatch } from './automation.types';

type AutomationRow = {
  id: string;
  tenant_id: string;
  recipient_profile:
    'financeiro' | 'administrativo' | 'administrativo_financeiro';
  outbound_channels: {
    id: string;
    base_url: string;
    access_token: string;
    active: boolean;
    status: string;
  };
  canned_responses: { body: string };
};

type Recipient = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  is_portal_admin: boolean;
  is_portal_financial: boolean;
};

@Injectable()
export class AutomationDispatchService {
  private readonly portalUrl: string;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly secrets: SecretsService,
    private readonly redis: RedisService,
    private readonly uazapi: UazapiService,
    private readonly email: EmailSenderService,
    config: ConfigService<Env, true>,
  ) {
    this.portalUrl = `${config.get('CORS_ORIGIN', { infer: true }).replace(/\/+$/, '')}/portal`;
  }

  private get db() {
    return this.supabase.client as unknown as SupabaseClient;
  }

  async claim(): Promise<AutomationDispatch[]> {
    const { data, error } = await this.db.rpc('claim_automation_dispatches', {
      p_limit: 25,
    });
    if (error) throw new Error(`automation_claim_failed:${error.message}`);
    return (data ?? []) as AutomationDispatch[];
  }

  async process(dispatch: AutomationDispatch) {
    const { data: automations, error } = await this.db
      .from('automations')
      .select(
        'id,tenant_id,recipient_profile,outbound_channels!inner(id,base_url,access_token,active,status),canned_responses!inner(body)',
      )
      .eq('tenant_id', dispatch.tenant_id)
      .eq('trigger_id', dispatch.trigger_id)
      .eq('active', true)
      .is('deleted_at', null);
    if (error) throw error;
    const recipients = await this.recipients(dispatch);
    const { data: documents, error: documentsError } = await this.db
      .from('client_documents')
      .select('competencia')
      .eq('tenant_id', dispatch.tenant_id)
      .eq('company_id', dispatch.company_id)
      .eq('publication_batch_id', dispatch.related_entity_id)
      .is('deleted_at', null);
    if (documentsError) throw documentsError;
    if (!documents?.length) return;

    const emailDelivery = this.sendDocumentEmails(
      dispatch.tenant_id,
      recipients,
    ).catch(() => false);
    const whatsappErrors: unknown[] = [];
    for (const automation of (automations ??
      []) as unknown as AutomationRow[]) {
      try {
        await this.execute(automation, dispatch, recipients, documents);
      } catch (error) {
        whatsappErrors.push(error);
      }
    }
    if (!(await emailDelivery))
      throw new Error('Falha no envio de avisos de documentos por e-mail.');
    if (whatsappErrors.length)
      throw new Error('Falha ao processar a automação de WhatsApp.');
  }

  private async recipients(dispatch: AutomationDispatch): Promise<Recipient[]> {
    const { data: links, error } = await this.db
      .from('contact_companies')
      .select('contact_id')
      .eq('company_id', dispatch.company_id)
      .eq('tenant_id', dispatch.tenant_id);
    if (error) throw error;
    const linkedIds = (links ?? []).map(
      (link: { contact_id: string }) => link.contact_id,
    );
    let query = this.db
      .from('contacts')
      .select('id,name,email,phone,is_portal_admin,is_portal_financial')
      .eq('tenant_id', dispatch.tenant_id)
      .eq('is_active', true)
      .not('company_id', 'is', null);
    query = linkedIds.length
      ? query.or(
          `company_id.eq.${dispatch.company_id},id.in.(${linkedIds.join(',')})`,
        )
      : query.eq('company_id', dispatch.company_id);
    const response = await query;
    if (response.error) throw response.error;
    return (response.data ?? []) as Recipient[];
  }

  private async sendDocumentEmails(
    tenantId: string,
    recipients: Recipient[],
  ): Promise<boolean> {
    const addresses = new Set(
      recipients
        .filter((contact) => contact.is_portal_financial)
        .flatMap((contact) =>
          contact.email?.trim() ? [contact.email.trim().toLowerCase()] : [],
        ),
    );
    if (!addresses.size) return true;
    const { data: tenant, error } = await this.supabase.client
      .from('tenants')
      .select(
        'name,email_enabled,email_imap_user,email_imap_password,email_smtp_host,email_smtp_port,email_smtp_secure',
      )
      .eq('id', tenantId)
      .maybeSingle();
    if (
      error ||
      !tenant?.email_enabled ||
      !tenant.email_smtp_host ||
      !tenant.email_imap_user ||
      !tenant.email_imap_password
    )
      return false;
    const smtp = {
      host: tenant.email_smtp_host,
      port: tenant.email_smtp_port,
      secure: tenant.email_smtp_secure,
      user: tenant.email_imap_user,
      password: this.secrets.decrypt(tenant.email_imap_password),
      fromName: tenant.name,
    };
    let delivered = true;
    for (const to of addresses) {
      try {
        await this.email.sendTenantEmail(smtp, {
          to,
          subject: 'Novos documentos no Portal do Cliente',
          text: `Há novos documentos disponíveis no Portal do Cliente do APTicket. Acesse: ${this.portalUrl}`,
        });
      } catch {
        delivered = false;
      }
    }
    return delivered;
  }

  private async execute(
    automation: AutomationRow,
    dispatch: AutomationDispatch,
    contacts: Recipient[],
    documents: Array<{ competencia?: string | null }>,
  ) {
    const { data: company } = await this.db
      .from('companies')
      .select('name')
      .eq('id', dispatch.company_id)
      .eq('tenant_id', dispatch.tenant_id)
      .maybeSingle();
    const recipients = contacts.filter((contact) => {
      if (automation.recipient_profile === 'financeiro')
        return contact.is_portal_financial;
      if (automation.recipient_profile === 'administrativo')
        return contact.is_portal_admin;
      return contact.is_portal_financial || contact.is_portal_admin;
    });

    const competencia = documents?.[0]?.competencia
      ? new Intl.DateTimeFormat('pt-BR', {
          month: '2-digit',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(
          new Date(
            `${String(documents[0].competencia).slice(0, 10)}T12:00:00Z`,
          ),
        )
      : '';
    let sent = 0;
    const failures: Array<{ contactId: string; error: string }> = [];

    if (!automation.outbound_channels.active) {
      failures.push({ contactId: '', error: 'Canal de saída inativo.' });
    } else {
      for (const contact of recipients) {
        if (!contact.phone) {
          failures.push({
            contactId: contact.id,
            error: 'Contato sem telefone.',
          });
          continue;
        }
        const limit = await this.redis.checkRateLimit(
          `automation:whatsapp:${dispatch.tenant_id}`,
          20,
          60,
        );
        if (!limit.allowed) {
          failures.push({
            contactId: contact.id,
            error: 'Limite temporário de envio atingido.',
          });
          continue;
        }
        const message = this.render(automation.canned_responses.body, {
          contato: contact.name,
          cliente: company?.name ?? '',
          competencia,
          portal_link: this.portalUrl,
          quantidade_documentos: String(documents?.length ?? 0),
        });
        const result = await this.uazapi.sendText(
          automation.outbound_channels.base_url,
          this.secrets.decrypt(automation.outbound_channels.access_token),
          contact.phone,
          message,
        );
        if (result.ok) sent += 1;
        else
          failures.push({
            contactId: contact.id,
            error: `UAZAPI ${result.status || 'indisponível'}`,
          });
      }
    }

    const status = !recipients.length
      ? 'skipped'
      : !failures.length
        ? 'success'
        : sent
          ? 'partial'
          : 'error';
    const { error: logError } = await this.db
      .from('automation_executions')
      .insert({
        tenant_id: dispatch.tenant_id,
        automation_id: automation.id,
        company_id: dispatch.company_id,
        related_entity_id: dispatch.related_entity_id,
        status,
        details: {
          recipients: recipients.length,
          sent,
          failures,
          documents: documents?.length ?? 0,
        },
      });
    if (logError) throw logError;
  }

  private render(template: string, values: Record<string, string>) {
    return template.replace(
      /{{\s*([a-z_]+)\s*}}/gi,
      (match, key: string) => values[key] ?? match,
    );
  }

  async finish(id: string, success: boolean, message?: string) {
    const { error } = await this.db.rpc('finish_automation_dispatch', {
      p_dispatch_id: id,
      p_success: success,
      p_error: message ?? null,
    });
    if (error) throw error;
  }
}
