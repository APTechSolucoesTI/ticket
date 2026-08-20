// Sessão própria do APTicket — client-side. NÃO usa supabase.auth.setSession()/
// getSession()/onAuthStateChange() pra sessão real: setSession() faz uma
// chamada de rede pro GoTrue (auth/v1/user) pra "hidratar" o usuário, e o
// GoTrue rejeita qualquer sub que não exista em auth.users com "User from
// sub claim in JWT does not exist" — mesmo a assinatura sendo válida. Isso
// quebra completamente pra usuário 100% novo (nunca existiu no GoTrue).
//
// Solução: gerenciar a sessão manualmente (localStorage + pub-sub próprio).
// O token (JWT compatível com o PostgREST — ver jwt.server.ts) é anexado nas
// chamadas supabase.from(...) via um fetch customizado (client.ts), sem
// nunca passar pelo subsistema .auth do supabase-js.
const STORAGE_KEY = "apticket_session_token";

type Listener = () => void;
const listeners = new Set<Listener>();

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, token);
  listeners.forEach((fn) => fn());
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
  listeners.forEach((fn) => fn());
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  tenantId: string;
}

/** Atalho pra quem só precisa do id do usuário logado (author_id, created_by
 * etc. em inserts) — substitui `(await supabase.auth.getUser()).data.user?.id`,
 * que dependia da sessão interna do supabase-js (não existe mais aqui). */
export function getCurrentUserId(): string | null {
  const token = getToken();
  return token ? (decodeSessionUser(token)?.id ?? null) : null;
}

/** Decodifica o payload do JWT sem verificar assinatura — client confia no
 * próprio token que ele mesmo guardou (a validação de verdade é sempre no
 * servidor: PostgREST via RLS, apps/api via jwt.util.ts). */
export function decodeSessionUser(token: string): SessionUser | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as {
      sub?: string;
      email?: string;
      name?: string;
      tenant_id?: string;
      exp?: number;
    };
    if (!claims.sub || !claims.email) return null;
    if (claims.exp && claims.exp * 1000 < Date.now()) return null;
    return {
      id: claims.sub,
      email: claims.email,
      name: claims.name ?? "",
      tenantId: claims.tenant_id ?? "",
    };
  } catch {
    return null;
  }
}
