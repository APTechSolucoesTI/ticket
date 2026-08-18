import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@apticket/shared-types/database';
import type { Env } from '../config/env.validation';

/**
 * Único client Supabase da API, sempre com a service_role key — mesmo
 * projeto/schema (`apticket`) que o frontend usa, mas aqui sem RLS pela
 * frente (a API é quem passa a decidir o que cada usuário pode ver/fazer,
 * validando o tenant_id do JWT em cada query — ver AuthModule).
 */
@Injectable()
export class SupabaseService {
  readonly client: SupabaseClient<Database, 'apticket'>;

  constructor(config: ConfigService<Env, true>) {
    const url: string = config.get('SUPABASE_URL', { infer: true });
    const key: string = config.get('SUPABASE_SERVICE_ROLE_KEY', {
      infer: true,
    });
    this.client = createClient<Database, 'apticket'>(url, key, {
      db: { schema: 'apticket' },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  /** Valida o JWT emitido pelo Supabase Auth pro usuário logado no frontend. */
  async getUserFromJwt(jwt: string) {
    const { data, error } = await this.client.auth.getUser(jwt);
    if (error || !data.user) return null;
    return data.user;
  }
}
