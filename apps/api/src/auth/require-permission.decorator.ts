import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'requiredPermission';

export interface RequiredPermission {
  module: string;
  action: string;
}

/**
 * Marca uma rota como exigindo uma permissão específica (módulo×ação, Bloco
 * 2 - papéis e permissões dinâmicos). Checado no mesmo `SupabaseAuthGuard`
 * global que já valida o JWT de sessão, contra `req.auth.permissions`
 * (resolvido via `apticket.get_effective_permissions`, uma chamada só por
 * request).
 */
export const RequirePermission = (module: string, action: string) =>
  SetMetadata(PERMISSION_KEY, { module, action } satisfies RequiredPermission);
