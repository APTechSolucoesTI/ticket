import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- outbound_channels entra nos tipos gerados após o deploy */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OutboundChannelDto } from '@apticket/shared-types';
import { SupabaseService } from '../../supabase/supabase.service';
import { SecretsService } from '../../crypto/secrets.service';
import { UazapiService } from './uazapi.service';
import type { UpsertOutboundChannelDto } from './dto/upsert-outbound-channel.dto';

type ChannelRow = {
  id: string;
  tenant_id: string;
  direction: 'outbound';
  name: string;
  provider: 'uazapi';
  base_url: string;
  access_token: string;
  instance_name: string | null;
  connected_number: string | null;
  status: 'disconnected' | 'qr_pending' | 'connected' | 'error';
  active: boolean;
};

@Injectable()
export class OutboundChannelService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly secrets: SecretsService,
    private readonly uazapi: UazapiService,
  ) {}

  private get db() {
    return this.supabase.client as unknown as SupabaseClient;
  }

  private dto(row: ChannelRow): OutboundChannelDto {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      direction: row.direction,
      name: row.name,
      provider: row.provider,
      baseUrl: row.base_url,
      instanceName: row.instance_name,
      connectedNumber: row.connected_number,
      status: row.status,
      active: row.active,
    };
  }

  async list(tenantId: string): Promise<OutboundChannelDto[]> {
    const { data, error } = await this.db
      .from('outbound_channels')
      .select('*')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('name');
    if (error) throw error;
    return ((data ?? []) as ChannelRow[]).map((row) => this.dto(row));
  }

  async upsert(
    tenantId: string,
    id: string | null,
    input: UpsertOutboundChannelDto,
  ): Promise<OutboundChannelDto> {
    const normalizedName = input.name.trim();
    const existing = id ? await this.row(tenantId, id) : null;
    if (!existing && !input.token) {
      throw new BadRequestException(
        'Informe o token da uazapi no primeiro cadastro.',
      );
    }
    const values = {
      tenant_id: tenantId,
      name: normalizedName,
      base_url: input.baseUrl.trim().replace(/\/+$/, ''),
      instance_name: input.instanceName?.trim() || null,
      active: input.active ?? true,
      ...(input.token
        ? { access_token: this.secrets.encrypt(input.token) }
        : {}),
    };
    const query = existing
      ? this.db.from('outbound_channels').update(values).eq('id', existing.id)
      : this.db.from('outbound_channels').insert(values);
    const { data, error } = await query.select('*').single();
    if (error) throw error;
    const channel = data as ChannelRow;
    if (!existing) await this.seedDefaultAutomation(tenantId, channel.id);
    return this.dto(channel);
  }

  private async seedDefaultAutomation(tenantId: string, channelId: string) {
    const { data: template } = await this.db
      .from('canned_responses')
      .select('id')
      .eq('tenant_id', tenantId)
      .ilike('title', 'Documentos Disponibilizados')
      .limit(1)
      .maybeSingle();
    if (!template) return;
    const { error } = await this.db.from('automations').insert({
      tenant_id: tenantId,
      name: 'Notificação financeira de documentos disponibilizados',
      trigger_id: 'documentos_disponibilizados',
      outbound_channel_id: channelId,
      recipient_profile: 'administrativo_financeiro',
      template_id: template.id,
      active: false,
    });
    if (error) throw error;
  }

  private async row(tenantId: string, id: string): Promise<ChannelRow> {
    const { data, error } = await this.db
      .from('outbound_channels')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();
    if (error || !data)
      throw new NotFoundException('Canal de saída não encontrado.');
    return data as ChannelRow;
  }

  private async credentials(tenantId: string, id: string) {
    const channel = await this.row(tenantId, id);
    return { channel, token: this.secrets.decrypt(channel.access_token) };
  }

  async status(tenantId: string, id: string) {
    const { channel, token } = await this.credentials(tenantId, id);
    const result = await this.uazapi.status(channel.base_url, token);
    await this.db
      .from('outbound_channels')
      .update({
        status: result.connected
          ? 'connected'
          : result.ok
            ? 'disconnected'
            : 'error',
        connected_number: result.number,
      })
      .eq('id', channel.id);
    return result;
  }

  async qrcode(tenantId: string, id: string) {
    const { channel, token } = await this.credentials(tenantId, id);
    const result = await this.uazapi.connect(channel.base_url, token);
    await this.db
      .from('outbound_channels')
      .update({ status: result.connected ? 'connected' : 'qr_pending' })
      .eq('id', channel.id);
    return result;
  }

  async disconnect(tenantId: string, id: string) {
    const { channel, token } = await this.credentials(tenantId, id);
    const result = await this.uazapi.disconnect(channel.base_url, token);
    await this.db
      .from('outbound_channels')
      .update({ status: 'disconnected', connected_number: null })
      .eq('id', channel.id);
    return result;
  }
}
