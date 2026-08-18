import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function normalizeNumber(raw: string): string {
  // UAZAPI expects digits only, including country code.
  return String(raw).replace(/\D/g, "");
}

async function callUazapi(
  baseUrl: string,
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const url = `${normalizeBaseUrl(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      token,
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep as text */
  }
  return { ok: res.ok, status: res.status, body };
}

/* ============================================================
 * Test connection — reads tenant credentials via RLS and pings UAZAPI
 * ============================================================ */
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
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (!profile?.tenant_id) throw new Error("Tenant não encontrado");

    let baseUrl = data.base_url;
    let token = data.token;
    if (!baseUrl || !token) {
      const { data: t } = await supabase
        .from("tenants")
        .select("whatsapp_uazapi_base_url, whatsapp_uazapi_token")
        .eq("id", profile.tenant_id)
        .maybeSingle();
      baseUrl = baseUrl ?? t?.whatsapp_uazapi_base_url ?? "";
      token = token ?? t?.whatsapp_uazapi_token ?? "";
    }
    if (!baseUrl || !token) throw new Error("Informe a URL base e o token da instância.");

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
      number: ((instance?.owner as string | undefined) ?? (instance?.number as string | undefined) ?? null) as string | null,
      raw: rawText,
      message: "OK",
    };
  });

/* ============================================================
 * Connect instance — returns QR code (base64) to pair the phone
 * ============================================================ */
async function loadTenantCreds(
  supabase: import("@supabase/supabase-js").SupabaseClient<import("@/integrations/supabase/types").Database>,
  userId: string,
) {
  const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
  if (!profile?.tenant_id) throw new Error("Tenant não encontrado");
  const { data: t } = await supabase
    .from("tenants")
    .select("id, whatsapp_uazapi_base_url, whatsapp_uazapi_token")
    .eq("id", profile.tenant_id)
    .maybeSingle();
  if (!t?.whatsapp_uazapi_base_url || !t?.whatsapp_uazapi_token) {
    throw new Error("Configure a URL base e o token da UAZAPI antes de conectar.");
  }
  return { tenantId: t.id, baseUrl: t.whatsapp_uazapi_base_url, token: t.whatsapp_uazapi_token };
}

export const connectUazapiInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { baseUrl, token } = await loadTenantCreds(supabase, userId);
    const r = await callUazapi(baseUrl, token, "/instance/connect", { method: "POST", body: "{}" });
    const b = (r.body ?? {}) as Record<string, unknown>;
    const inst = (b.instance as Record<string, unknown> | undefined) ?? b;
    let qr =
      (b.qrcode as string | undefined) ??
      (b.qr as string | undefined) ??
      (inst?.qrcode as string | undefined) ??
      (inst?.qr as string | undefined) ??
      null;
    if (qr && !qr.startsWith("data:")) qr = `data:image/png;base64,${qr}`;
    return {
      ok: r.ok,
      status: r.status,
      qrcode: qr,
      connected: inst?.status === "connected" || inst?.state === "open",
      raw: typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? null),
    };
  });

export const disconnectUazapiInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { tenantId, baseUrl, token } = await loadTenantCreds(supabase, userId);
    const r = await callUazapi(baseUrl, token, "/instance/disconnect", { method: "POST", body: "{}" });
    await supabase.from("tenants").update({ whatsapp_connected_number: null }).eq("id", tenantId);
    return { ok: r.ok, status: r.status };
  });



/* ============================================================
 * Send WhatsApp reply for a ticket
 * ============================================================ */
export const sendWhatsAppReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        ticket_id: z.string().uuid(),
        content: z.string().min(1).max(10000),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: ticket, error: tErr } = await supabase
      .from("tickets")
      .select("id, tenant_id, channel, contact_id, contacts(phone,name)")
      .eq("id", data.ticket_id)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!ticket) throw new Error("Ticket não encontrado");
    if (ticket.channel !== "whatsapp") throw new Error("Ticket não é de origem WhatsApp");

    const phone = (ticket as { contacts?: { phone?: string | null } | null }).contacts?.phone;
    if (!phone) throw new Error("Contato sem número de telefone");

    const { data: tenant } = await supabase
      .from("tenants")
      .select("whatsapp_enabled, whatsapp_uazapi_base_url, whatsapp_uazapi_token")
      .eq("id", ticket.tenant_id)
      .maybeSingle();
    if (!tenant?.whatsapp_enabled || !tenant.whatsapp_uazapi_base_url || !tenant.whatsapp_uazapi_token) {
      throw new Error("WhatsApp não configurado para este tenant");
    }

    const number = normalizeNumber(phone);
    let deliveryStatus: "sent" | "failed" = "failed";
    let externalId: string | null = null;
    let lastErr: string | null = null;

    // Retry with backoff for rate limiting
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const r = await callUazapi(tenant.whatsapp_uazapi_base_url, tenant.whatsapp_uazapi_token, "/send/text", {
        method: "POST",
        body: JSON.stringify({ number, text: data.content }),
      });
      if (r.ok) {
        deliveryStatus = "sent";
        const b = (r.body ?? {}) as Record<string, unknown>;
        externalId =
          (b.messageid as string | undefined) ??
          (b.id as string | undefined) ??
          ((b.message as Record<string, unknown> | undefined)?.id as string | undefined) ??
          null;
        break;
      }
      lastErr = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
      if (r.status === 429 || r.status >= 500) {
        await new Promise((res) => setTimeout(res, 500 * attempt));
        continue;
      }
      break;
    }

    const { data: inserted, error: insErr } = await supabase
      .from("messages")
      .insert({
        tenant_id: ticket.tenant_id,
        ticket_id: ticket.id,
        content: data.content,
        author_id: userId,
        author_type: "agent",
        is_internal: false,
        channel: "whatsapp",
        external_id: externalId,
        delivery_status: deliveryStatus,
      })
      .select("id")
      .single();
    if (insErr) throw insErr;

    if (deliveryStatus === "failed") {
      throw new Error(`Falha ao enviar via UAZAPI: ${lastErr ?? "erro desconhecido"}`);
    }

    return { ok: true, message_id: inserted.id, external_id: externalId };
  });

/* ============================================================
 * Send WhatsApp MEDIA (image / document / audio) for a ticket
 * ============================================================ */
export const sendWhatsAppMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        ticket_id: z.string().uuid(),
        url: z.string().url(),
        filename: z.string().min(1),
        mimetype: z.string().min(1),
        caption: z.string().max(1024).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: ticket } = await supabase
      .from("tickets")
      .select("id, tenant_id, channel, contacts(phone)")
      .eq("id", data.ticket_id)
      .maybeSingle();
    if (!ticket) throw new Error("Ticket não encontrado");
    if (ticket.channel !== "whatsapp") throw new Error("Ticket não é WhatsApp");
    const phone = (ticket as { contacts?: { phone?: string | null } | null }).contacts?.phone;
    if (!phone) throw new Error("Contato sem telefone");

    const { data: tenant } = await supabase
      .from("tenants")
      .select("whatsapp_enabled, whatsapp_uazapi_base_url, whatsapp_uazapi_token")
      .eq("id", ticket.tenant_id)
      .maybeSingle();
    if (!tenant?.whatsapp_enabled || !tenant.whatsapp_uazapi_base_url || !tenant.whatsapp_uazapi_token) {
      throw new Error("WhatsApp não configurado");
    }

    const kind = data.mimetype.startsWith("image/")
      ? "image"
      : data.mimetype.startsWith("audio/")
        ? "audio"
        : data.mimetype.startsWith("video/")
          ? "video"
          : "document";

    const r = await callUazapi(tenant.whatsapp_uazapi_base_url, tenant.whatsapp_uazapi_token, "/send/media", {
      method: "POST",
      body: JSON.stringify({
        number: normalizeNumber(phone),
        type: kind,
        file: data.url,
        filename: data.filename,
        text: data.caption ?? "",
      }),
    });
    const b = (r.body ?? {}) as Record<string, unknown>;
    const externalId =
      (b.messageid as string | undefined) ??
      (b.id as string | undefined) ??
      ((b.message as Record<string, unknown> | undefined)?.id as string | undefined) ??
      null;

    const { data: inserted, error: insErr } = await supabase
      .from("messages")
      .insert({
        tenant_id: ticket.tenant_id,
        ticket_id: ticket.id,
        content: data.caption ?? `[${kind}] ${data.filename}`,
        author_id: userId,
        author_type: "agent",
        is_internal: false,
        channel: "whatsapp",
        external_id: externalId,
        delivery_status: r.ok ? "sent" : "failed",
        attachments: [{ path: data.url, name: data.filename, size: 0, type: data.mimetype, url: data.url }],
      })
      .select("id")
      .single();
    if (insErr) throw insErr;
    if (!r.ok) throw new Error(`Falha UAZAPI: ${typeof r.body === "string" ? r.body : JSON.stringify(r.body)}`);
    return { ok: true, message_id: inserted.id, external_id: externalId };
  });

/* ============================================================
 * Send status change notification via WhatsApp
 * ============================================================ */
async function sendPlainWa(
  supabase: import("@supabase/supabase-js").SupabaseClient<import("@/integrations/supabase/types").Database>,
  ticketId: string,
  text: string,
) {
  const { data: ticket } = await supabase
    .from("tickets")
    .select("id, tenant_id, channel, contact_id, contacts(phone)")
    .eq("id", ticketId)
    .maybeSingle();
  if (!ticket || ticket.channel !== "whatsapp") return { skipped: true as const };
  const phone = (ticket as { contacts?: { phone?: string | null } | null }).contacts?.phone;
  if (!phone) return { skipped: true as const };

  const { data: tenant } = await supabase
    .from("tenants")
    .select("whatsapp_enabled, whatsapp_uazapi_base_url, whatsapp_uazapi_token")
    .eq("id", ticket.tenant_id)
    .maybeSingle();
  if (!tenant?.whatsapp_enabled || !tenant.whatsapp_uazapi_base_url || !tenant.whatsapp_uazapi_token) {
    return { skipped: true as const };
  }
  const r = await callUazapi(tenant.whatsapp_uazapi_base_url, tenant.whatsapp_uazapi_token, "/send/text", {
    method: "POST",
    body: JSON.stringify({ number: normalizeNumber(phone), text }),
  });
  await supabase.from("messages").insert({
    tenant_id: ticket.tenant_id,
    ticket_id: ticket.id,
    content: text,
    author_type: "system",
    is_internal: false,
    channel: "whatsapp",
    delivery_status: r.ok ? "sent" : "failed",
  });
  return { skipped: false as const, ok: r.ok, contact_id: ticket.contact_id, tenant_id: ticket.tenant_id };
}

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
  .handler(async ({ data, context }) => {
    const messages: Record<string, string> = {
      in_progress: "Seu chamado está em atendimento. Retornaremos em breve.",
      pending: "Seu chamado está pendente. Aguardamos retorno para prosseguir.",
      resolved: "Seu chamado foi resolvido. Se o problema persistir, responda esta mensagem para reabrir.",
      closed: "Seu chamado foi fechado. Obrigado por escolher nosso suporte!",
    };
    return await sendPlainWa(context.supabase, data.ticket_id, messages[data.status]);
  });

/* ============================================================
 * Send CSAT invite via WhatsApp
 * ============================================================ */
export const sendCsatInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ ticket_id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: ticket } = await supabase
      .from("tickets")
      .select("id, tenant_id, contact_id, channel, contacts(phone)")
      .eq("id", data.ticket_id)
      .maybeSingle();
    if (!ticket) throw new Error("Ticket não encontrado");

    // Reuse or create CSAT row with token
    const { data: existing } = await supabase
      .from("csat_responses")
      .select("id, token, responded_at")
      .eq("ticket_id", ticket.id)
      .maybeSingle();

    let token = existing?.token ?? null;
    if (!token) {
      token = crypto.randomUUID().replace(/-/g, "");
      const row = existing
        ? await supabase.from("csat_responses").update({ token, sent_at: new Date().toISOString() }).eq("id", existing.id)
        : await supabase.from("csat_responses").insert({
            tenant_id: ticket.tenant_id,
            ticket_id: ticket.id,
            contact_id: ticket.contact_id,
            token,
            sent_at: new Date().toISOString(),
          });
      if (row.error) throw row.error;
    }

    // Send WhatsApp invite if applicable
    if (ticket.channel === "whatsapp") {
      const origin = (process.env.PUBLIC_APP_URL as string | undefined) ?? "https://app.example.com";
      const link = `${origin.replace(/\/+$/, "")}/csat/${token}`;
      await sendPlainWa(
        context.supabase,
        ticket.id,
        `Como você avalia nosso atendimento? Responda em 1 clique: ${link}`,
      );
    }
    return { ok: true, token };
  });

/* ============================================================
 * Send WhatsApp CONTACT card
 * ============================================================ */
export const sendWhatsAppContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        ticket_id: z.string().uuid(),
        contact_name: z.string().min(1),
        contact_phone: z.string().min(3),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: ticket } = await supabase
      .from("tickets")
      .select("id, tenant_id, channel, contacts(phone)")
      .eq("id", data.ticket_id)
      .maybeSingle();
    if (!ticket || ticket.channel !== "whatsapp") throw new Error("Ticket não é WhatsApp");
    const phone = (ticket as { contacts?: { phone?: string | null } | null }).contacts?.phone;
    if (!phone) throw new Error("Contato sem telefone");
    const { data: tenant } = await supabase
      .from("tenants")
      .select("whatsapp_enabled, whatsapp_uazapi_base_url, whatsapp_uazapi_token")
      .eq("id", ticket.tenant_id)
      .maybeSingle();
    if (!tenant?.whatsapp_enabled || !tenant.whatsapp_uazapi_base_url || !tenant.whatsapp_uazapi_token)
      throw new Error("WhatsApp não configurado");
    const r = await callUazapi(tenant.whatsapp_uazapi_base_url, tenant.whatsapp_uazapi_token, "/send/contact", {
      method: "POST",
      body: JSON.stringify({
        number: normalizeNumber(phone),
        fullName: data.contact_name,
        phoneNumber: normalizeNumber(data.contact_phone),
      }),
    });
    const b = (r.body ?? {}) as Record<string, unknown>;
    const externalId = (b.messageid as string | undefined) ?? (b.id as string | undefined) ?? null;
    await supabase.from("messages").insert({
      tenant_id: ticket.tenant_id,
      ticket_id: ticket.id,
      content: `📇 Contato: ${data.contact_name} — ${data.contact_phone}`,
      author_id: userId,
      author_type: "agent",
      is_internal: false,
      channel: "whatsapp",
      external_id: externalId,
      delivery_status: r.ok ? "sent" : "failed",
    });
    if (!r.ok) throw new Error(`Falha UAZAPI: ${typeof r.body === "string" ? r.body : JSON.stringify(r.body)}`);
    return { ok: true };
  });

/* ============================================================
 * Send WhatsApp LOCATION
 * ============================================================ */
export const sendWhatsAppLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        ticket_id: z.string().uuid(),
        latitude: z.number(),
        longitude: z.number(),
        name: z.string().optional(),
        address: z.string().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: ticket } = await supabase
      .from("tickets")
      .select("id, tenant_id, channel, contacts(phone)")
      .eq("id", data.ticket_id)
      .maybeSingle();
    if (!ticket || ticket.channel !== "whatsapp") throw new Error("Ticket não é WhatsApp");
    const phone = (ticket as { contacts?: { phone?: string | null } | null }).contacts?.phone;
    if (!phone) throw new Error("Contato sem telefone");
    const { data: tenant } = await supabase
      .from("tenants")
      .select("whatsapp_enabled, whatsapp_uazapi_base_url, whatsapp_uazapi_token")
      .eq("id", ticket.tenant_id)
      .maybeSingle();
    if (!tenant?.whatsapp_enabled || !tenant.whatsapp_uazapi_base_url || !tenant.whatsapp_uazapi_token)
      throw new Error("WhatsApp não configurado");
    const r = await callUazapi(tenant.whatsapp_uazapi_base_url, tenant.whatsapp_uazapi_token, "/send/location", {
      method: "POST",
      body: JSON.stringify({
        number: normalizeNumber(phone),
        latitude: data.latitude,
        longitude: data.longitude,
        name: data.name ?? "",
        address: data.address ?? "",
      }),
    });
    const b = (r.body ?? {}) as Record<string, unknown>;
    const externalId = (b.messageid as string | undefined) ?? (b.id as string | undefined) ?? null;
    await supabase.from("messages").insert({
      tenant_id: ticket.tenant_id,
      ticket_id: ticket.id,
      content: `📍 Localização: ${data.name ?? ""} ${data.address ?? ""} (${data.latitude}, ${data.longitude})`.trim(),
      author_id: userId,
      author_type: "agent",
      is_internal: false,
      channel: "whatsapp",
      external_id: externalId,
      delivery_status: r.ok ? "sent" : "failed",
    });
    if (!r.ok) throw new Error(`Falha UAZAPI: ${typeof r.body === "string" ? r.body : JSON.stringify(r.body)}`);
    return { ok: true };
  });

/* ============================================================
 * Send WhatsApp STICKER (webp URL)
 * ============================================================ */
export const sendWhatsAppSticker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z.object({ ticket_id: z.string().uuid(), url: z.string().url() }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: ticket } = await supabase
      .from("tickets")
      .select("id, tenant_id, channel, contacts(phone)")
      .eq("id", data.ticket_id)
      .maybeSingle();
    if (!ticket || ticket.channel !== "whatsapp") throw new Error("Ticket não é WhatsApp");
    const phone = (ticket as { contacts?: { phone?: string | null } | null }).contacts?.phone;
    if (!phone) throw new Error("Contato sem telefone");
    const { data: tenant } = await supabase
      .from("tenants")
      .select("whatsapp_enabled, whatsapp_uazapi_base_url, whatsapp_uazapi_token")
      .eq("id", ticket.tenant_id)
      .maybeSingle();
    if (!tenant?.whatsapp_enabled || !tenant.whatsapp_uazapi_base_url || !tenant.whatsapp_uazapi_token)
      throw new Error("WhatsApp não configurado");
    const r = await callUazapi(tenant.whatsapp_uazapi_base_url, tenant.whatsapp_uazapi_token, "/send/media", {
      method: "POST",
      body: JSON.stringify({ number: normalizeNumber(phone), type: "sticker", file: data.url }),
    });
    const b = (r.body ?? {}) as Record<string, unknown>;
    const externalId = (b.messageid as string | undefined) ?? (b.id as string | undefined) ?? null;
    await supabase.from("messages").insert({
      tenant_id: ticket.tenant_id,
      ticket_id: ticket.id,
      content: "🎨 Figurinha",
      author_id: userId,
      author_type: "agent",
      is_internal: false,
      channel: "whatsapp",
      external_id: externalId,
      delivery_status: r.ok ? "sent" : "failed",
      attachments: [{ path: data.url, name: "sticker.webp", size: 0, type: "image/webp", url: data.url }],
    });
    if (!r.ok) throw new Error(`Falha UAZAPI: ${typeof r.body === "string" ? r.body : JSON.stringify(r.body)}`);
    return { ok: true };
  });

/* ============================================================
 * Trigger WhatsApp CALL (fake/ring) via UAZAPI POST /call/make
 * ============================================================ */
export const sendWhatsAppCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        ticket_id: z.string().uuid(),
        duration: z.number().int().min(1).max(60).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: ticket } = await supabase
      .from("tickets")
      .select("id, tenant_id, channel, contacts(phone)")
      .eq("id", data.ticket_id)
      .maybeSingle();
    if (!ticket || ticket.channel !== "whatsapp") throw new Error("Ticket não é WhatsApp");
    const phone = (ticket as { contacts?: { phone?: string | null } | null }).contacts?.phone;
    if (!phone) throw new Error("Contato sem telefone");
    const { data: tenant } = await supabase
      .from("tenants")
      .select("whatsapp_enabled, whatsapp_uazapi_base_url, whatsapp_uazapi_token")
      .eq("id", ticket.tenant_id)
      .maybeSingle();
    if (!tenant?.whatsapp_enabled || !tenant.whatsapp_uazapi_base_url || !tenant.whatsapp_uazapi_token)
      throw new Error("WhatsApp não configurado");
    const duration = data.duration ?? 15;
    const r = await callUazapi(tenant.whatsapp_uazapi_base_url, tenant.whatsapp_uazapi_token, "/call/make", {
      method: "POST",
      body: JSON.stringify({ number: normalizeNumber(phone), duration }),
    });
    await supabase.from("messages").insert({
      tenant_id: ticket.tenant_id,
      ticket_id: ticket.id,
      content: `📞 Ligação disparada (${duration}s)`,
      author_id: userId,
      author_type: "agent",
      is_internal: false,
      channel: "whatsapp",
      delivery_status: r.ok ? "sent" : "failed",
    });
    if (!r.ok) throw new Error(`Falha UAZAPI: ${typeof r.body === "string" ? r.body : JSON.stringify(r.body)}`);
    return { ok: true };
  });

