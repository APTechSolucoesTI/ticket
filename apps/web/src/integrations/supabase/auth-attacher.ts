import { createMiddleware } from "@tanstack/react-start";
import { getToken } from "@/lib/session";

// Registrado como `functionMiddleware` global em src/start.ts - sem isso o
// browser nunca anexa o bearer token nas chamadas de createServerFn (login,
// inviteUser, etc). Lê session.ts (sessão própria) em vez de
// supabase.auth.getSession() - sem setSession()/persistSession, o
// supabase-js não tem mais sessão interna nenhuma pra devolver.
export const attachSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const token = getToken();
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
);
