import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
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
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUser(readUser());
    setLoading(false);
    return subscribe(() => setUser(readUser()));
  }, []);

  const signOut = async () => {
    clearToken();
    setUser(null);
  };

  return (
    <Ctx.Provider value={{ user, session: user ? { user } : null, loading, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
