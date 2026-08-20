// Valida JWT compatível com o PostgREST do Supabase self-hosted — mesmo
// JWT_SECRET que GOTRUE_JWT_SECRET/PGRST_JWT_SECRET já usam. Duplicado
// (pequeno) da versão em apps/web/src/lib/jwt.server.ts — packages/shared-types
// só funciona como tipo puro (apagado no build), não dá pra compartilhar
// valor de runtime de lá sem arriscar quebrar o Node puro do apps/api.
//
// apps/api só PRECISA verificar (nunca assina — quem emite token é sempre o
// apps/web, no login/convite/reset).
import jwt from 'jsonwebtoken';

export interface SessionClaims {
  sub: string;
  email: string;
  tenantId: string;
}

export function verifySessionToken(
  token: string,
  secret: string,
): SessionClaims | null {
  try {
    const decoded = jwt.verify(token, secret);
    if (
      typeof decoded === 'string' ||
      !decoded.sub ||
      typeof decoded.email !== 'string'
    ) {
      return null;
    }
    return {
      sub: decoded.sub,
      email: decoded.email,
      tenantId: typeof decoded.tenant_id === 'string' ? decoded.tenant_id : '',
    };
  } catch {
    return null;
  }
}
