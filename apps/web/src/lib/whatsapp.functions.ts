import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { publicHttpRequest } from "@apticket/outbound-network";
async function requirePermission(
  supabase: import("@supabase/supabase-js").SupabaseClient<
    import("@/integrations/supabase/types").Database
  >,
  userId: string,
  module: string,
  action: string,
) {
  const { data: allowed, error } = await supabase.rpc("has_permission", {
    _user_id: userId,
    _module: module,
    _action: action,
  });
  if (error) throw new Error(error.message);
  if (!allowed) throw new Error("Sem permissão para esta ação.");
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

async function callUazapi(
  baseUrl: string,
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const url = `${normalizeBaseUrl(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`;
  if (init?.body !== undefined && init.body !== null && typeof init.body !== "string") {
    throw new Error("unsupported_request_body");
  }
  const res = await publicHttpRequest(url, {
    method: init?.method,
    body: init?.body ?? undefined,
    signal: init?.signal ?? undefined,
    credentials: true,
    headers: {
      "Content-Type": "application/json",
      token,
      ...Object.fromEntries(new Headers(init?.headers)),
    },
  });
  const text = res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep as text */
  }
  return { ok: res.ok, status: res.status, body };
}

async function backendAction(tenantId: string, action: string, data?: Record<string, unknown>) {
  const response = await fetch(
    new URL(
      `/channels/whatsapp/instances/${tenantId}/${action}`,
      process.env.INTERNAL_BACKEND_URL ?? "http://api:3001",
    ),
    {
      method: data ? "POST" : "GET",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: getRequest().headers.get("Authorization") ?? "",
        "Content-Type": "application/json",
      },
      body: data ? JSON.stringify(data) : undefined,
    },
  );
  if (!response.ok) throw new Error("Não foi possível concluir a operação de WhatsApp.");
  return z
    .object({
      ok: z.boolean().optional(),
      skipped: z.boolean().optional(),
      token: z.string().optional(),
      connected: z.boolean().optional(),
      number: z.string().nullable().optional(),
    })
    .parse(await response.json());
}
export const testUazapiConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        base_url: z.string().url().optional(),
        token: z.string().min(1).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requirePermission(supabase, userId, "canais", "edit");
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (!profile?.tenant_id) throw new Error("Tenant não encontrado");

    const baseUrl = data.base_url;
    const token = data.token;
    // Saved credentials are handled exclusively by the API.
    if (!baseUrl || !token) return backendAction(context.claims.tenantId, "status");

    // UAZAPI status endpoint
    const r = await callUazapi(baseUrl, token, "/instance/status", { method: "GET" });
    const rawText = typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? null);
    if (!r.ok) {
      return {
        ok: false as const,
        status: r.status,
        connected: false,
        number: null as string | null,
        raw: rawText,
        message: "Instância indisponível ou credenciais inválidas.",
      };
    }
    const b = (r.body ?? {}) as Record<string, unknown>;
    const instance = (b.instance as Record<string, unknown> | undefined) ?? b;
    return {
      ok: true as const,
      status: r.status,
      connected:
        instance?.status === "connected" ||
        instance?.state === "open" ||
        (b as { connected?: boolean }).connected === true,
      number: ((instance?.owner as string | undefined) ??
        (instance?.number as string | undefined) ??
        null) as string | null,
      raw: rawText,
      message: "OK",
    };
  });

export const notifyTicketStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        ticket_id: z.string().uuid(),
        status: z.enum(["in_progress", "pending", "resolved", "closed"]),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) =>
    backendAction(context.claims.tenantId, "notify-status", {
      ticketId: data.ticket_id,
      status: data.status,
    }),
  );

export const sendCsatInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ ticket_id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) =>
    backendAction(context.claims.tenantId, "csat", { ticketId: data.ticket_id }),
  );
