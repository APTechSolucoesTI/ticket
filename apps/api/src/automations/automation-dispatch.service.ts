import { Injectable } from '@nestjs/common';
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unnecessary-type-assertion -- tabelas da migration atual entram nos tipos gerados após o deploy */
import { ConfigService } from '@nestjs/config';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../supabase/supabase.service';
import { SecretsService } from '../crypto/secrets.service';
import { RedisService } from '../queue/redis.service';
import { UazapiService } from '../channels/whatsapp/uazapi.service';
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

@Injectable()
export class AutomationDispatchService {
  private readonly portalUrl: string;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly secrets: SecretsService,
    private readonly redis: RedisService,
    private readonly uazapi: UazapiService,
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
    for (const automation of (automations ??
      []) as unknown as AutomationRow[]) {
      await this.execute(automation, dispatch);
    }
  }

  private async execute(
    automation: AutomationRow,
    dispatch: AutomationDispatch,
  ) {
    const { data: company } = await this.db
      .from('companies')
      .select('name')
      .eq('id', dispatch.company_id)
      .eq('tenant_id', dispatch.tenant_id)
      .maybeSingle();
    const { data: links } = await this.db
      .from('contact_companies')
      .select('contact_id')
      .eq('company_id', dispatch.company_id)
      .eq('tenant_id', dispatch.tenant_id);
    const contactIds = (links ?? []).map(
      (item: { contact_id: string }) => item.contact_id,
    );
    let recipients: Array<{
      id: string;
      name: string;
      phone: string | null;
      is_portal_admin: boolean;
      is_portal_financial: boolean;
    }> = [];
    if (contactIds.length) {
      const response = await this.db
        .from('contacts')
        .select('id,name,phone,is_portal_admin,is_portal_financial')
        .eq('tenant_id', dispatch.tenant_id)
        .eq('is_active', true)
        .in('id', contactIds);
      recipients = (response.data ?? []) as typeof recipients;
    }
    recipients = recipients.filter((contact) => {
      if (automation.recipient_profile === 'financeiro')
        return contact.is_portal_financial;
      if (automation.recipient_profile === 'administrativo')
        return contact.is_portal_admin;
      return contact.is_portal_financial || contact.is_portal_admin;
    });

    const { data: documents } = await this.db
      .from('client_documents')
      .select('competencia')
      .eq('tenant_id', dispatch.tenant_id)
      .eq('publication_batch_id', dispatch.related_entity_id)
      .is('deleted_at', null);
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
