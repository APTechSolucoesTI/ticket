import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  getToken,
  clearToken,
  subscribe,
  decodeSessionUser,
  type SessionUser,
} from "@/lib/session";

// Sessão própria do APTicket - não usa supabase.auth.* (ver session.ts pro
// motivo: setSession()/getSession() fariam chamada de rede pro GoTrue, que
// rejeita qualquer usuário que não exista em auth.users). `user`/`session`
// aqui são derivados só do JWT decodificado localmente.
type AuthCtx = {
  user: SessionUser | null;
  session: { user: SessionUser } | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

function readUser(): SessionUser | null {
  const token = getToken();
  return token ? decodeSessionUser(token) : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const initialClient = useQueryClient();
  const [{ user, client }, setSession] = useState<{
    user: SessionUser | null;
    client: QueryClient;
  }>({
    user: null,
    client: initialClient,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let current = { user: readUser(), client: initialClient };
    setSession(current);
    setLoading(false);
    return subscribe(() => {
      const nextUser = readUser();
      if (current.user?.id !== nextUser?.id || current.user?.tenantId !== nextUser?.tenantId) {
        // Cancel before clearing: a response from the previous identity must
        // not repopulate legacy query keys after the account changes.
        void current.client.cancelQueries();
        current.client.clear();
        // Pending mutation callbacks retain their original client. Retire it
        // completely so optimistic rollbacks cannot write into the new scope.
        current = {
          user: nextUser,
          client: new QueryClient({ defaultOptions: initialClient.getDefaultOptions() }),
        };
      } else {
        current = { ...current, user: nextUser };
      }
      setSession(current);
    });
  }, [initialClient]);

  const signOut = async () => {
    clearToken();
  };

  return (
    <Ctx.Provider
      key={JSON.stringify([user?.tenantId, user?.id])}
      value={{ user, session: user ? { user } : null, loading, signOut }}
    >
      {/* Remount observers and local state that may still hold private data. */}
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
