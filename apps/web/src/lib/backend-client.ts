// Client HTTP pro backend novo (apps/api) - passa pela rota de proxy
// same-origin (src/routes/backend/$.ts), então o browser nunca fala
// direto com o container da API. Anexa o JWT da sessão própria (session.ts)
// como Bearer - é isso que o SupabaseAuthGuard da API valida (localmente,
// mesmo JWT_SECRET, sem chamar o GoTrue).
import { getToken, handleSessionResponse } from "@/lib/session";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  if (!token) throw new Error("Sessão expirada - faça login novamente.");
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...init?.headers,
  };
  const res = await fetch(`/backend${path}`, { ...init, headers });
  handleSessionResponse(res, token);
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = (
      body && typeof body === "object" && "message" in body ? body.message : null
    ) as string | string[] | null;
    throw new Error(
      Array.isArray(message) ? message.join(", ") : (message ?? `Erro ${res.status}`),
    );
  }
  return body as T;
}

export const backendClient = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PATCH",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
