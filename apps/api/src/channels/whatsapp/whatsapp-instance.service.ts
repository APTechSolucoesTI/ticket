import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { SupabaseService } from '../../supabase/supabase.service';
import { SecretsService } from '../../crypto/secrets.service';
import { UazapiService } from './uazapi.service';
import type { UpsertWhatsappInstanceDto } from './dto/upsert-whatsapp-instance.dto';
import type { WhatsappInstanceDto } from '@apticket/shared-types';
import type { TablesUpdate } from '@apticket/shared-types/database';

// Mesma adaptação do EmailModule: "instância" é 1 por tenant (colunas
// whatsapp_* em apticket.tenants), não uma tabela separada.
@Injectable()
export class WhatsappInstanceService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly secrets: SecretsService,
    private readonly uazapi: UazapiService,
  ) {}

  async get(tenantId: string): Promise<WhatsappInstanceDto | null> {
    const { data, error } = await this.supabase.client
      .from('tenants')
      .select(
        'id, whatsapp_uazapi_base_url, whatsapp_enabled, whatsapp_uazapi_instance, whatsapp_connected_number, whatsapp_webhook_secret',
      )
      .eq('id', tenantId)
      .maybeSingle();
    if (error || !data) return null;
    return {
      tenantId: data.id,
      baseUrl: data.whatsapp_uazapi_base_url,
      instanceName: data.whatsapp_uazapi_instance,
      connectedNumber: data.whatsapp_connected_number,
      status: data.whatsapp_connected_number ? 'connected' : 'disconnected',
      webhookSecret: data.whatsapp_webhook_secret,
    };
  }

  /** Cria/atualiza credenciais; gera o segredo do webhook na primeira vez. */
  async upsert(
    tenantId: string,
    dto: UpsertWhatsappInstanceDto,
  ): Promise<WhatsappInstanceDto> {
    const { data: existing } = await this.supabase.client
      .from('tenants')
      .select('whatsapp_webhook_secret, whatsapp_uazapi_token')
      .eq('id', tenantId)
      .maybeSingle();
    const webhookSecret =
      existing?.whatsapp_webhook_secret || randomBytes(24).toString('hex');

    const values: TablesUpdate<'tenants'> = {
      whatsapp_uazapi_base_url: dto.baseUrl,
      whatsapp_uazapi_instance: dto.instanceName ?? null,
      whatsapp_enabled: dto.enabled ?? true,
      whatsapp_webhook_secret: webhookSecret,
    };
    if (dto.token) {
      values.whatsapp_uazapi_token = this.secrets.encrypt(dto.token);
    } else if (!existing?.whatsapp_uazapi_token) {
      throw new BadRequestException(
        'Informe o token da uazapi na primeira configuração.',
      );
    }

    const { error } = await this.supabase.client
      .from('tenants')
      .update(values)
      .eq('id', tenantId);
    if (error) throw error;

    const account = await this.get(tenantId);
    if (!account) throw new NotFoundException('Tenant não encontrado');
    return account;
  }

  private async creds(tenantId: string) {
    const { data: t } = await this.supabase.client
      .from('tenants')
      .select('whatsapp_uazapi_base_url, whatsapp_uazapi_token')
      .eq('id', tenantId)
      .maybeSingle();
    if (!t?.whatsapp_uazapi_base_url || !t.whatsapp_uazapi_token) {
      throw new NotFoundException(
        'Configure a URL base e o token da uazapi antes de conectar.',
      );
    }
    return {
      baseUrl: t.whatsapp_uazapi_base_url,
      token: this.secrets.decrypt(t.whatsapp_uazapi_token),
    };
  }

  async status(tenantId: string) {
    const { baseUrl, token } = await this.creds(tenantId);
    return this.uazapi.status(baseUrl, token);
  }

  async qrcode(tenantId: string) {
    const { baseUrl, token } = await this.creds(tenantId);
    return this.uazapi.connect(baseUrl, token);
  }

  async disconnect(tenantId: string) {
    const { baseUrl, token } = await this.creds(tenantId);
    const r = await this.uazapi.disconnect(baseUrl, token);
    await this.supabase.client
      .from('tenants')
      .update({ whatsapp_connected_number: null })
      .eq('id', tenantId);
    return r;
  }
}
