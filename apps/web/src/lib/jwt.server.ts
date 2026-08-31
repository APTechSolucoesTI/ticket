// Assina/valida JWT compatível com o PostgREST do Supabase self-hosted -
// mesmo JWT_SECRET que GOTRUE_JWT_SECRET/PGRST_JWT_SECRET já usam (confirmado
// no .env do Supabase). Qualquer JWT HS256 assinado com esse segredo, com
// claim `sub` = uuid válido de apticket.profiles e `role: authenticated`, é
// aceito pelo PostgREST como se fosse do GoTrue - é assim que RLS/auth.uid()
// continuam funcionando sem tocar em nenhuma das ~163 chamadas
// `supabase.from(...)` que já existem no app inteiro.
//
// Duplicado (pequeno, ~30 linhas) em apps/api também em vez de compartilhar
// via packages/shared-types - esse pacote só funciona como tipo puro hoje
// (apagado no build do tsc), importar valor de runtime de lá quebraria o
// apps/api rodando puro Node sem transpiler de TS.
import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET;

export interface SessionClaims {
  sub: string;
  email: string;
  name: string;
  tenantId: string;
  app: "apticket";
}

export function signSessionToken(profile: {
  id: string;
  email: string;
  name: string;
  tenantId: string;
}): string {
  if (!SECRET) throw new Error("JWT_SECRET não configurado");
  return jwt.sign(
    {
      email: profile.email,
      name: profile.name,
      role: "authenticated",
      aud: "authenticated",
      app: "apticket",
      tenant_id: profile.tenantId,
    },
    SECRET,
    { subject: profile.id, expiresIn: "7d", algorithm: "HS256" },
  );
}

export function verifySessionToken(token: string): SessionClaims | null {
  if (!SECRET) return null;
  try {
    const decoded = jwt.verify(token, SECRET, {
      algorithms: ["HS256"],
      audience: "authenticated",
    });
    if (
      typeof decoded === "string" ||
      !decoded.sub ||
      typeof decoded.email !== "string" ||
      decoded.role !== "authenticated" ||
      decoded.app !== "apticket" ||
      typeof decoded.tenant_id !== "string"
    ) {
      return null;
    }
    return {
      sub: decoded.sub,
      email: decoded.email,
      name: typeof decoded.name === "string" ? decoded.name : "",
      tenantId: decoded.tenant_id,
      app: "apticket",
    };
  } catch {
    return null;
  }
}
