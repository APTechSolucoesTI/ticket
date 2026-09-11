import { Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { SupabaseService } from '../supabase/supabase.service';
import { SecretsService } from '../crypto/secrets.service';
import { RedisService } from '../queue/redis.service';
import { EmailSenderService } from '../channels/email/email-sender.service';
import { UazapiService } from '../channels/whatsapp/uazapi.service';
import type {
  CollectionAction,
  ContractFinancialEventResult,
} from './collection.types';

const actionSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  operating_company_id: z.string().uuid(),
  channel: z.enum(['email', 'whatsapp', 'sms']),
  attempt_count: z.number().int().positive(),
  recipient_snapshot: z.object({
    contact_id: z.string().uuid().nullable().optional(),
    name: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    customer_name: z.string().nullable().optional(),
  }),
  content_snapshot: z.object({
    subject: z.string().nullable().optional(),
    message_template: z.string(),
    document: z.string().nullable().optional(),
    amount: z.coerce.number().nullable().optional(),
    due_date: z.string().nullable().optional(),
  }),
});

const contractFinancialEventResultSchema = z.object({
  suspended_contracts: z.number().int().nonnegative(),
  released_contracts: z.number().int().nonnegative(),
  ignored_events: z.number().int().nonnegative(),
  failed_events: z.number().int().nonnegative(),
});

export class CollectionDispatchError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

@Injectable()
export class CollectionDispatchService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly secrets: SecretsService,
    private readonly redis: RedisService,
    private readonly email: EmailSenderService,
    private readonly uazapi: UazapiService,
  ) {}

  private get db() {
    return this.supabase.client as unknown as SupabaseClient;
  }

  async prepareActions(): Promise<CollectionAction[]> {
    const today = new Date().toISOString().slice(0, 10);
    const scheduled = await this.db.rpc('schedule_collection_policies', {
      p_as_of: today,
      p_limit: 100,
    });
    if (scheduled.error)
      throw new Error(`collection_schedule_failed:${scheduled.error.code}`);
    const claimed = await this.db.rpc('claim_collection_actions', {
      p_limit: 100,
    });
    if (claimed.error)
      throw new Error(`collection_claim_failed:${claimed.error.code}`);
    return z.array(actionSchema).parse(claimed.data);
  }

  async dispatch(action: CollectionAction): Promise<string | null> {
    const message = this.render(
      action.content_snapshot.message_template,
      action,
    );
    if (action.channel === 'email') return this.sendEmail(action, message);
    if (action.channel === 'whatsapp')
      return this.sendWhatsapp(action, message);
    throw new CollectionDispatchError(
      'Provedor SMS ainda não configurado para esta tenant.',
      false,
    );
  }

  async processContractEvents(): Promise<ContractFinancialEventResult> {
    const today = new Date().toISOString().slice(0, 10);
    const response = await this.db.rpc('process_contract_financial_events', {
      p_limit: 100,
      p_as_of: today,
    });
    if (response.error)
      throw new Error(
        `contract_financial_events_failed:${response.error.code}`,
      );
    return contractFinancialEventResultSchema.parse(response.data);
  }

  async finish(
    actionId: string,
    result: {
      success: boolean;
      externalId?: string | null;
      error?: string;
      retryable?: boolean;
    },
  ) {
    const response = await this.db.rpc('finish_collection_action', {
      p_action: actionId,
      p_success: result.success,
      p_external_id: result.externalId ?? null,
      p_error: result.error ?? null,
      p_retryable: result.retryable ?? true,
    });
    if (response.error)
      throw new Error(`collection_finish_failed:${response.error.code}`);
  }

  private render(template: string, action: CollectionAction) {
    const dueDate = action.content_snapshot.due_date
      ? new Date(
          `${action.content_snapshot.due_date}T12:00:00`,
        ).toLocaleDateString('pt-BR')
      : '';
    const amount = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(action.content_snapshot.amount ?? 0);
    const values: Record<string, string> = {
      documento: action.content_snapshot.document ?? '',
      vencimento: dueDate,
      valor: amount,
      cliente:
        action.recipient_snapshot.customer_name ??
        action.recipient_snapshot.name ??
        '',
    };
    return template.replace(
      /{{\s*(documento|vencimento|valor|cliente)\s*}}/g,
      (_, key: string) => values[key] ?? '',
    );
  }

  private async tenant(tenantId: string) {
    const { data, error } = await this.supabase.client
      .from('tenants')
      .select(
        'name,email_enabled,email_imap_user,email_imap_password,email_smtp_host,email_smtp_port,email_smtp_secure,whatsapp_enabled,whatsapp_uazapi_base_url,whatsapp_uazapi_token',
      )
      .eq('id', tenantId)
      .maybeSingle();
    if (error || !data)
      throw new CollectionDispatchError(
        'Tenant da cobrança não encontrado.',
        false,
      );
    return data;
  }

  private async sendEmail(action: CollectionAction, message: string) {
    const recipient = action.recipient_snapshot.email?.trim();
    if (!recipient)
      throw new CollectionDispatchError(
        'Contato financeiro sem e-mail.',
        false,
      );
    const tenant = await this.tenant(action.tenant_id);
    if (
      !tenant.email_enabled ||
      !tenant.email_imap_user ||
      !tenant.email_imap_password ||
      !tenant.email_smtp_host
    ) {
      throw new CollectionDispatchError(
        'Canal de e-mail da tenant não configurado.',
        true,
      );
    }
    const result = await this.email.sendTenantEmail(
      {
        host: tenant.email_smtp_host,
        port: tenant.email_smtp_port,
        secure: tenant.email_smtp_secure,
        user: tenant.email_imap_user,
        password: this.secrets.decrypt(tenant.email_imap_password),
        fromName: tenant.name,
      },
      {
        to: recipient,
        subject:
          action.content_snapshot.subject?.trim() || 'Lembrete de pagamento',
        text: message,
      },
    );
    return result.messageId;
  }

  private async sendWhatsapp(action: CollectionAction, message: string) {
    const recipient = action.recipient_snapshot.phone?.trim();
    if (!recipient)
      throw new CollectionDispatchError(
        'Contato financeiro sem telefone.',
        false,
      );
    const tenant = await this.tenant(action.tenant_id);
    if (
      !tenant.whatsapp_enabled ||
      !tenant.whatsapp_uazapi_base_url ||
      !tenant.whatsapp_uazapi_token
    ) {
      throw new CollectionDispatchError(
        'Canal de WhatsApp da tenant não configurado.',
        true,
      );
    }
    const rate = await this.redis.checkRateLimit(
      `collection:whatsapp:${action.tenant_id}`,
      20,
      60,
    );
    if (!rate.allowed)
      throw new CollectionDispatchError(
        'Limite temporário do WhatsApp atingido.',
        true,
      );
    const response = await this.uazapi.sendText(
      tenant.whatsapp_uazapi_base_url,
      this.secrets.decrypt(tenant.whatsapp_uazapi_token),
      recipient,
      message,
    );
    if (!response.ok) {
      const retryable =
        response.status === 0 ||
        response.status === 429 ||
        response.status >= 500;
      throw new CollectionDispatchError(
        `Falha UAZAPI (${response.status || 'rede'}).`,
        retryable,
      );
    }
    const body = (response.body ?? {}) as Record<string, unknown>;
    return (
      (body.messageid as string | undefined) ??
      (body.id as string | undefined) ??
      ((body.message as Record<string, unknown> | undefined)?.id as
        string | undefined) ??
      null
    );
  }
}
