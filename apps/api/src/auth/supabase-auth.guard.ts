import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SupabaseService } from '../supabase/supabase.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { verifySessionToken } from './jwt.util';
import {
  PERMISSION_KEY,
  type RequiredPermission,
} from './require-permission.decorator';
import type { Env } from '../config/env.validation';

export interface AuthContext {
  userId: string;
  email: string;
  tenantId: string;
  name: string;
  roles: string[];
  /** Bloco 2 — permissões efetivas (módulo×ação) já resolvidas pro usuário. */
  permissions: { module: string; action: string }[];
}

export interface AuthenticatedRequest extends Request {
  auth: AuthContext;
}

/**
 * Guard global (registrado em AppModule via APP_GUARD). Valida o JWT de
 * sessão do APTicket (assinado pelo apps/web no login/convite/reset, mesmo
 * JWT_SECRET que o PostgREST do Supabase já usa pra RLS — ver
 * apps/web/src/lib/jwt.server.ts) e resolve o tenant_id/roles a partir de
 * `apticket.profiles`/`apticket.user_roles` — mesma coisa que o RLS faz hoje
 * via `current_tenant_id()`, só que aqui é a API quem aplica o filtro de
 * tenant manualmente em cada query, já que o client usa a service_role key
 * (sem RLS pela frente).
 *
 * Verificação é local (assinatura HS256), não uma chamada de rede pro
 * GoTrue — funciona pra JWT que o GoTrue nunca viu (usuário migrado pra
 * autenticação própria), e é mais rápido (sem round-trip externo).
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private readonly logger = new Logger(SupabaseAuthGuard.name);
  private readonly jwtSecret: string;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly reflector: Reflector,
    config: ConfigService<Env, true>,
  ) {
    this.jwtSecret = config.get('JWT_SECRET', { infer: true });
  }

  canActivate(context: ExecutionContext): Promise<boolean> | boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return this.checkAuth(context);
  }

  private async checkAuth(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authorization: Bearer <jwt> ausente');
    }
    const jwt = authHeader.slice('Bearer '.length);

    const claims = verifySessionToken(jwt, this.jwtSecret);
    if (!claims) throw new UnauthorizedException('Sessão inválida ou expirada');

    const { data: profile, error } = await this.supabase.client
      .from('profiles')
      .select('tenant_id, name, is_active')
      .eq('id', claims.sub)
      .maybeSingle();
    if (error) {
      // Mensagem pro client fica genérica de propósito (não vaza detalhe de
      // schema/infra), mas o erro real do Postgrest/Supabase (ex.: schema
      // "apticket" não exposto na Data API) só aparece aqui no log — sem
      // isso, um erro de config de infra parecia idêntico a "usuário sem
      // perfil" e era impossível diferenciar só pela resposta HTTP.
      this.logger.error(
        `falha ao buscar profile de ${claims.sub}: ${error.message}`,
      );
      throw new UnauthorizedException('Usuário sem perfil ativo no tenant');
    }
    if (!profile || !profile.is_active) {
      throw new UnauthorizedException('Usuário sem perfil ativo no tenant');
    }

    const { data: roleRows } = await this.supabase.client
      .from('user_roles')
      .select('role_id')
      .eq('user_id', claims.sub);

    const { data: permRows, error: permErr } = await this.supabase.client.rpc(
      'get_effective_permissions',
      { _user_id: claims.sub },
    );
    if (permErr) {
      this.logger.error(
        `falha ao resolver permissões efetivas de ${claims.sub}: ${permErr.message}`,
      );
    }
    const permissions = (permRows ?? [])
      .filter((p) => p.effective)
      .map((p) => ({ module: p.module, action: p.action }));

    req.auth = {
      userId: claims.sub,
      email: claims.email,
      tenantId: profile.tenant_id,
      name: profile.name,
      roles: (roleRows ?? []).map((r) => r.role_id),
      permissions,
    };

    const required = this.reflector.getAllAndOverride<RequiredPermission>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (
      required &&
      !permissions.some(
        (p) => p.module === required.module && p.action === required.action,
      )
    ) {
      throw new ForbiddenException('Sem permissão para esta ação');
    }

    return true;
  }
}
