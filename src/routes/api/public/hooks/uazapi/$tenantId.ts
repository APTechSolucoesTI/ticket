import { createFileRoute } from "@tanstack/react-router";
import { secureEquals } from "@/lib/secure-compare";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/rate-limit";

/**
 * UAZAPI webhook receiver — per tenant.
 * URL: /api/public/hooks/uazapi/:tenantId?secret=<whatsapp_webhook_secret>
 *
 * Handles:
 *  - message events (incoming text/attachments): find/create contact, ensure active
 *    contract, create/update ticket, append message.
 *  - status events (delivery/read): update messages.delivery_status by external_id.
 *  - connection events (qr/disconnect): logged for now.
 */

type UnknownRec = Record<string, unknown>;

function digits(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

function asRecord(v: unknown): UnknownRec | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as UnknownRec) : null;
}

function firstRecord(v: unknown): UnknownRec | null {
  if (Array.isArray(v)) return asRecord(v[0]);
  return asRecord(v);
}

function stripBrazilCountryCode(v: string): string {
  return v.startsWith("55") && v.length > 11 ? v.slice(2) : v;
}

function phoneVariants(v: unknown): string[] {
  const d = digits(v);
  if (!d) return [];
  return Array.from(new Set([d, stripBrazilCountryCode(d)].filter((p) => p.length >= 8)));
}

function samePhone(a: unknown, b: unknown): boolean {
  const av = phoneVariants(a);
  const bv = phoneVariants(b);
  return av.some((x) =>
    bv.some((y) => x === y || (x.length >= 8 && y.length >= 8 && (x.endsWith(y) || y.endsWith(x)))),
  );
}

function candidateRecords(payload: UnknownRec): UnknownRec[] {
  const data = asRecord(payload.data);
  const message = asRecord(payload.message);
  const firstMessage = firstRecord(payload.messages) ?? firstRecord(data?.messages);
  const nestedMessage = asRecord(message?.message) ?? asRecord(data?.message);
  const firstNestedMessage = firstRecord(nestedMessage?.messages);

  return [payload, data, message, firstMessage, nestedMessage, firstNestedMessage].filter(
    Boolean,
  ) as UnknownRec[];
}

function extractPhone(payload: UnknownRec): string | null {
  for (const record of candidateRecords(payload)) {
    const key = asRecord(record.key);
    const candidates = [
      record.phone,
      record.number,
      record.from,
      record.chatid,
      record.chatId,
      record.sender,
      record.senderJid,
      record.remoteJid,
      key?.participant,
      key?.remoteJid,
      record.chatJid,
    ];
    for (const c of candidates) {
      const variants = phoneVariants(c);
      if (variants[0]) return variants[0];
    }
  }
  return null;
}

function textFromRecord(record: UnknownRec | null): string | null {
  if (!record) return null;
  const nested = asRecord(record.message);
  const extended = asRecord(nested?.extendedTextMessage) ?? asRecord(record.extendedTextMessage);
  const image = asRecord(nested?.imageMessage) ?? asRecord(record.imageMessage);
  const video = asRecord(nested?.videoMessage) ?? asRecord(record.videoMessage);
  const document = asRecord(nested?.documentMessage) ?? asRecord(record.documentMessage);
  const candidates = [
    record.text,
    record.body,
    record.caption,
    record.transcription,
    record.conversation,
    record.content,
    nested?.conversation,
    extended?.text,
    image?.caption,
    video?.caption,
    document?.caption,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

function extractText(payload: UnknownRec): string {
  const messageList = [payload.messages, asRecord(payload.data)?.messages]
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .map(asRecord)
    .filter(Boolean) as UnknownRec[];
  const groupedText = messageList.map(textFromRecord).filter(Boolean).join("\n");
  if (groupedText.trim()) return groupedText.trim();

  for (const record of candidateRecords(payload)) {
    const text = textFromRecord(record);
    if (text) return text;
  }

  return typeof payload.message === "string" ? payload.message.trim() : "";
}

function extractExternalId(payload: UnknownRec): string | null {
  for (const record of candidateRecords(payload)) {
    const key = asRecord(record.key);
    const id = record.id ?? record.messageid ?? record.messageId ?? record.messageID ?? key?.id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return null;
}

function extractName(payload: UnknownRec): string | null {
  for (const record of candidateRecords(payload)) {
    const name = record.pushname ?? record.pushName ?? record.senderName ?? record.notifyName;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return null;
}

function normalizeStatus(raw: unknown): string | null {
  const s = String(raw ?? "").toLowerCase();
  if (!s) return null;
  if (s.includes("read")) return "read";
  if (s.includes("deliver")) return "delivered";
  if (s.includes("sent") || s.includes("server")) return "sent";
  if (s.includes("fail") || s.includes("error")) return "failed";
  return s;
}

export const Route = createFileRoute("/api/public/hooks/uazapi/$tenantId")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204 }),
      GET: async () => Response.json({ ok: true, service: "uazapi-webhook" }),
      POST: async ({ request, params }) => {
        const tenantId = params.tenantId;
        const ip = clientIp(request);
        const ipLimit = checkRateLimit(`uazapi-webhook:ip:${ip}`, 300, 5 * 60 * 1000);
        if (!ipLimit.allowed) return rateLimitedResponse(ipLimit.retryAfterSeconds);
        const tenantLimit = checkRateLimit(`uazapi-webhook:tenant:${tenantId}`, 300, 5 * 60 * 1000);
        if (!tenantLimit.allowed) return rateLimitedResponse(tenantLimit.retryAfterSeconds);

        const url = new URL(request.url);
        const authorization = request.headers.get("authorization") ?? "";
        const bearerSecret = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
        const providedSecret =
          url.searchParams.get("secret") ??
          request.headers.get("x-webhook-secret") ??
          request.headers.get("x-uazapi-secret") ??
          request.headers.get("x-api-key") ??
          request.headers.get("token") ??
          bearerSecret ??
          "";

        let payload: UnknownRec;
        try {
          payload = (await request.json()) as UnknownRec;
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select("id, whatsapp_enabled, whatsapp_webhook_secret, whatsapp_uazapi_instance")
          .eq("id", tenantId)
          .maybeSingle();

        if (!tenant || !tenant.whatsapp_enabled) {
          return Response.json({ error: "tenant_not_configured" }, { status: 404 });
        }
        const payloadSecret = typeof payload.secret === "string" ? payload.secret : "";
        const resolvedSecret = providedSecret || payloadSecret;
        // A tenant with no webhook secret configured is NOT "open" — it is unconfigured.
        // Previously an empty tenant.whatsapp_webhook_secret skipped verification entirely,
        // letting anyone inject messages/tickets for that tenant. Require an explicit,
        // non-empty match instead.
        if (
          !tenant.whatsapp_webhook_secret ||
          !secureEquals(tenant.whatsapp_webhook_secret, resolvedSecret)
        ) {
          console.warn("[uazapi] invalid or missing webhook secret", {
            tenantId,
            hasTenantSecret: Boolean(tenant.whatsapp_webhook_secret),
            hasQueryOrHeaderSecret: Boolean(providedSecret),
            hasPayloadSecret: Boolean(payloadSecret),
            keys: Object.keys(payload).slice(0, 20),
          });
          return Response.json({ error: "invalid_secret" }, { status: 401 });
        }

        const eventType = String(
          payload.event ?? payload.type ?? payload.EventType ?? "",
        ).toLowerCase();

        /* ---------------- status update (delivery/read) ---------------- */
        if (eventType.includes("status") || eventType.includes("ack")) {
          const extId = extractExternalId(payload);
          const status = normalizeStatus(payload.status ?? payload.ack);
          if (extId && status) {
            await supabaseAdmin
              .from("messages")
              .update({ delivery_status: status })
              .eq("tenant_id", tenantId)
              .eq("external_id", extId);
          }
          return Response.json({ ok: true, kind: "status" });
        }

        /* ---------------- connection events ---------------- */
        if (
          eventType.includes("connect") ||
          eventType.includes("qr") ||
          eventType.includes("disconnect")
        ) {
          console.log("[uazapi] connection event", tenantId, eventType, payload);
          return Response.json({ ok: true, kind: "connection" });
        }

        /* ---------------- incoming message ---------------- */
        // Ignore messages sent by the instance itself (fromMe/outgoing echoes)
        const messageObj =
          firstRecord(payload.messages) ??
          asRecord(payload.message) ??
          asRecord(payload.data) ??
          payload;
        const fromMe = candidateRecords(payload).some((record) => {
          const key = asRecord(record.key);
          return record.fromMe === true || record.fromme === true || key?.fromMe === true;
        });
        if (fromMe) return Response.json({ ok: true, ignored: "from_me" });

        const phone = extractPhone(payload);
        const text = extractText(payload);
        const extId = extractExternalId(payload);
        const pushName = extractName(payload);
        const nestedMsg = asRecord(messageObj.message);
        const imageMsg = asRecord(nestedMsg?.imageMessage) ?? asRecord(messageObj.imageMessage);
        const stickerMsg =
          asRecord(nestedMsg?.stickerMessage) ?? asRecord(messageObj.stickerMessage);
        const audioMsg = asRecord(nestedMsg?.audioMessage) ?? asRecord(messageObj.audioMessage);
        const videoMsg = asRecord(nestedMsg?.videoMessage) ?? asRecord(messageObj.videoMessage);
        const documentMsg =
          asRecord(nestedMsg?.documentMessage) ?? asRecord(messageObj.documentMessage);
        const nestedMedia = imageMsg ?? stickerMsg ?? audioMsg ?? videoMsg ?? documentMsg ?? null;
        const mediaObj = (messageObj.media ??
          messageObj.attachment ??
          nestedMedia ??
          null) as UnknownRec | null;
        const mediaUrl =
          (messageObj.mediaUrl as string | undefined) ??
          (messageObj.fileUrl as string | undefined) ??
          (messageObj.fileURL as string | undefined) ??
          (messageObj.url as string | undefined) ??
          (mediaObj?.url as string | undefined) ??
          (mediaObj?.fileURL as string | undefined) ??
          (mediaObj?.directPath as string | undefined) ??
          null;
        const mediaType: string | null = stickerMsg
          ? "sticker"
          : imageMsg
            ? "image"
            : audioMsg
              ? "audio"
              : videoMsg
                ? "video"
                : documentMsg
                  ? "document"
                  : ((messageObj.type as string | undefined) ?? null);
        const defaultMime =
          mediaType === "sticker"
            ? "image/webp"
            : mediaType === "image"
              ? "image/jpeg"
              : mediaType === "audio"
                ? "audio/ogg"
                : mediaType === "video"
                  ? "video/mp4"
                  : "application/octet-stream";
        const mimetype =
          (messageObj.mimetype as string | undefined) ??
          (mediaObj?.mimetype as string | undefined) ??
          (mediaObj?.type as string | undefined) ??
          defaultMime;
        const fileName =
          (messageObj.filename as string | undefined) ??
          (mediaObj?.filename as string | undefined) ??
          (mediaObj?.name as string | undefined) ??
          (mediaType === "sticker" ? `sticker-${Date.now()}.webp` : `anexo-${Date.now()}`);
        const hasAttachment = mediaUrl != null || mediaObj != null;
        const attachments = (hasAttachment
          ? [{ path: "", url: mediaUrl ?? "", name: fileName, size: 0, type: mimetype }]
          : []) as unknown as import("@/integrations/supabase/types").Json;

        if (!phone || (!text && !hasAttachment)) {
          console.warn("[uazapi] ignored webhook without phone/content", {
            tenantId,
            hasPhone: Boolean(phone),
            hasText: Boolean(text),
            hasAttachment,
            keys: Object.keys(payload).slice(0, 20),
          });
          return Response.json({ ok: true, ignored: "no_content" });
        }

        if (extId) {
          const [{ data: existingMessage }, { data: existingPending }] = await Promise.all([
            supabaseAdmin
              .from("messages")
              .select("id, ticket_id")
              .eq("tenant_id", tenantId)
              .eq("external_id", extId)
              .maybeSingle(),
            supabaseAdmin
              .from("whatsapp_pending_messages")
              .select("id")
              .eq("tenant_id", tenantId)
              .eq("external_id", extId)
              .maybeSingle(),
          ]);
          if (existingMessage?.ticket_id) {
            return Response.json({
              ok: true,
              duplicate: true,
              ticket_id: existingMessage.ticket_id,
            });
          }
          if (existingPending?.id) {
            return Response.json({ ok: true, duplicate: true, pending_id: existingPending.id });
          }
        }

        // 1) Find contact by phone (digits-only match on either side)
        const { data: contactMatches } = await supabaseAdmin
          .from("contacts")
          .select("id, tenant_id, company_id, name, phone, can_open_tickets, is_active")
          .eq("tenant_id", tenantId);

        let contact = (contactMatches ?? []).find((c) => samePhone(c.phone, phone)) ?? null;

        // 2) If contact missing, auto-create as PENDING (no company yet).
        //    An agent will link it to a client from the "Fila WhatsApp" screen.
        if (!contact) {
          const { data: newContact, error: cErr } = await supabaseAdmin
            .from("contacts")
            .insert({
              tenant_id: tenantId,
              company_id: null,
              name: pushName || `WhatsApp ${phone}`,
              phone,
              email: null,
              is_active: true,
              can_open_tickets: false,
              notes:
                "Contato criado automaticamente via WhatsApp — aguardando vínculo com cliente.",
            })
            .select("id, tenant_id, company_id, name, phone, can_open_tickets, is_active")
            .single();
          if (cErr || !newContact) {
            console.error("[uazapi] create pending contact failed", cErr);
            return Response.json({ error: "create_contact_failed" }, { status: 500 });
          }
          contact = newContact;
        }

        // Log incoming message on a "pending" ticket-less record is not possible
        // (messages requires ticket_id). Store the raw payload for later linking.
        if (!contact.company_id) {
          const { data: pending, error: pendingErr } = await supabaseAdmin
            .from("whatsapp_pending_messages")
            .insert({
              tenant_id: tenantId,
              contact_id: contact.id,
              phone,
              content: text || "[anexo]",
              external_id: extId,
              payload: payload as unknown as import("@/integrations/supabase/types").Json,
            })
            .select("id")
            .maybeSingle();
          if (pendingErr) {
            console.error("[uazapi] pending insert failed", pendingErr);
            return Response.json({ error: "pending_insert_failed" }, { status: 500 });
          }
          return Response.json({
            ok: true,
            pending: "contact_not_linked_to_company",
            contact_id: contact.id,
            pending_id: pending?.id,
          });
        }

        if (contact.is_active === false || contact.can_open_tickets === false) {
          console.warn("[uazapi] contact blocked", { tenantId, contactId: contact.id });
          const { data: pending, error: pendingErr } = await supabaseAdmin
            .from("whatsapp_pending_messages")
            .insert({
              tenant_id: tenantId,
              contact_id: contact.id,
              phone,
              content: text || "[anexo]",
              external_id: extId,
              payload: payload as unknown as import("@/integrations/supabase/types").Json,
            })
            .select("id")
            .maybeSingle();
          if (pendingErr) {
            console.error("[uazapi] blocked contact pending insert failed", pendingErr);
            return Response.json({ error: "pending_insert_failed" }, { status: 500 });
          }
          if (!pending?.id) {
            console.warn("[uazapi] blocked contact pending insert returned empty", {
              tenantId,
              contactId: contact.id,
            });
          }
          return Response.json({ ok: true, pending: "contact_blocked", pending_id: pending?.id });
        }

        // 3) Active contract required
        const { data: contracts } = await supabaseAdmin
          .from("contracts")
          .select("id, sla_policy_id, includes_remote, includes_lab, includes_onsite")
          .eq("tenant_id", tenantId)
          .eq("company_id", contact.company_id)
          .eq("status", "active")
          .order("starts_at", { ascending: false });

        const contract = (contracts ?? []).find(
          (c) => c.includes_remote || c.includes_lab || c.includes_onsite,
        );

        if (!contract) {
          console.warn("[uazapi] pending — no active contract", {
            tenantId,
            contactId: contact.id,
          });
          const { data: pending, error: pendingErr } = await supabaseAdmin
            .from("whatsapp_pending_messages")
            .insert({
              tenant_id: tenantId,
              contact_id: contact.id,
              phone,
              content: text || "[anexo]",
              external_id: extId,
              payload: payload as unknown as import("@/integrations/supabase/types").Json,
            })
            .select("id")
            .maybeSingle();
          if (pendingErr) {
            console.error("[uazapi] no-contract pending insert failed", pendingErr);
            return Response.json({ error: "pending_insert_failed" }, { status: 500 });
          }
          if (!pending?.id) {
            console.warn("[uazapi] no-contract pending insert returned empty", {
              tenantId,
              contactId: contact.id,
            });
          }
          return Response.json({
            ok: true,
            pending: "no_active_contract",
            pending_id: pending?.id,
          });
        }

        // 4) Reuse open ticket for this contact on WhatsApp channel, else create one
        const { data: openTickets } = await supabaseAdmin
          .from("tickets")
          .select("id, status")
          .eq("tenant_id", tenantId)
          .eq("contact_id", contact.id)
          .eq("channel", "whatsapp")
          .not("status", "in", "(resolved,closed)")
          .order("created_at", { ascending: false })
          .limit(1);

        let ticketId = openTickets?.[0]?.id ?? null;

        if (!ticketId) {
          const subject = (text || "Mensagem via WhatsApp").slice(0, 200);
          const { data: newT, error: tErr } = await supabaseAdmin
            .from("tickets")
            .insert({
              tenant_id: tenantId,
              subject,
              status: "new",
              priority: "medium",
              channel: "whatsapp",
              contact_id: contact.id,
              company_id: contact.company_id,
              contract_id: contract.id,
              sla_policy_id: contract.sla_policy_id ?? null,
              pending_type: "awaiting_tech",
            })
            .select("id")
            .single();
          if (tErr || !newT) {
            console.error("[uazapi] create ticket failed", tErr);
            return Response.json({ error: "create_ticket_failed" }, { status: 500 });
          }
          ticketId = newT.id;
        }

        // 5) Append message
        const { error: msgErr } = await supabaseAdmin.from("messages").insert({
          tenant_id: tenantId,
          ticket_id: ticketId,
          author_contact_id: contact.id,
          author_type: "contact",
          channel: "whatsapp",
          is_internal: false,
          content: text || "[anexo]",
          external_id: extId,
          delivery_status: "received",
          attachments,
        });
        if (msgErr) {
          console.error("[uazapi] insert message failed", msgErr);
          return Response.json({ error: "insert_message_failed" }, { status: 500 });
        }

        return Response.json({ ok: true, ticket_id: ticketId });
      },
    },
  },
});
