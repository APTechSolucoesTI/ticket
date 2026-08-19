import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SupabaseService } from '../supabase/supabase.service';
import { IS_PUBLIC_KEY } from './public.decorator';

export interface AuthContext {
  userId: string;
  email: string;
  tenantId: string;
  name: string;
  roles: string[];
}

export interface AuthenticatedRequest extends Request {
  auth: AuthContext;
}

/**
 * Guard global (registrado em AppModule via APP_GUARD). Valida o JWT do
 * Supabase Auth emitido pro usuário logado no frontend e resolve o
 * tenant_id/roles a partir de `apticket.profiles`/`apticket.user_roles` —
 * mesma coisa que o RLS faz hoje via `current_tenant_id()`, só que aqui é a
 * API quem aplica o filtro de tenant manualmente em cada query, já que o
 * client usa a service_role key (sem RLS pela frente).
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private readonly logger = new Logger(SupabaseAuthGuard.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authorization: Bearer <jwt> ausente');
    }
    const jwt = authHeader.slice('Bearer '.length);

    const user = await this.supabase.getUserFromJwt(jwt);
    if (!user) throw new UnauthorizedException('Sessão inválida ou expirada');

    const { data: profile, error } = await this.supabase.client
      .from('profiles')
      .select('tenant_id, name, is_active')
      .eq('id', user.id)
      .maybeSingle();
    if (error) {
      // Mensagem pro client fica genérica de propósito (não vaza detalhe de
      // schema/infra), mas o erro real do Postgrest/Supabase (ex.: schema
      // "apticket" não exposto na Data API) só aparece aqui no log — sem
      // isso, um erro de config de infra parecia idêntico a "usuário sem
      // perfil" e era impossível diferenciar só pela resposta HTTP.
      this.logger.error(
        `falha ao buscar profile de ${user.id}: ${error.message}`,
      );
      throw new UnauthorizedException('Usuário sem perfil ativo no tenant');
    }
    if (!profile || !profile.is_active) {
      throw new UnauthorizedException('Usuário sem perfil ativo no tenant');
    }

    const { data: roleRows } = await this.supabase.client
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('tenant_id', profile.tenant_id);

    req.auth = {
      userId: user.id,
      email: user.email ?? '',
      tenantId: profile.tenant_id,
      name: profile.name,
      roles: (roleRows ?? []).map((r) => r.role),
    };
    return true;
  }
}
