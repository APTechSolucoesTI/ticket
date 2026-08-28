import { createFileRoute } from "@tanstack/react-router";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/rate-limit";
import { verifyPortalRequest } from "@/lib/portal-session";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 5;

export const Route = createFileRoute("/api/public/portal/ticket-reply")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const ip = clientIp(request);
        const ipLimit = checkRateLimit(`portal-ticket-reply:ip:${ip}`, 40, 10 * 60 * 1000);
        if (!ipLimit.allowed) return rateLimitedResponse(ipLimit.retryAfterSeconds, CORS);

        const session = verifyPortalRequest(request);
        if (!session) {
          return Response.json({ error: "unauthorized" }, { status: 401, headers: CORS });
        }

        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return Response.json({ error: "invalid_form" }, { status: 400, headers: CORS });
        }
        const ticket_id = String(form.get("ticket_id") ?? "").trim();
        const content = String(form.get("content") ?? "").trim();
        if (!ticket_id) {
          return Response.json({ error: "invalid_payload" }, { status: 400, headers: CORS });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: ticket } = await supabaseAdmin
          .from("tickets")
          .select("id, tenant_id, status, channel")
          .eq("id", ticket_id)
          .eq("tenant_id", session.tenant_id)
          .eq("contact_id", session.contact_id)
          .maybeSingle();
        if (!ticket) return Response.json({ error: "not_found" }, { status: 404, headers: CORS });

        const files = form
          .getAll("files")
          .filter((f): f is File => f instanceof File && f.size > 0);
        if (!content && files.length === 0) {
          return Response.json({ error: "invalid_payload" }, { status: 400, headers: CORS });
        }
        if (files.length > MAX_FILES) {
          return Response.json({ error: "too_many_files" }, { status: 400, headers: CORS });
        }
        const oversized = files.find((file) => file.size > MAX_FILE_BYTES);
        if (oversized) {
          return Response.json(
            { error: "file_too_large", name: oversized.name },
            { status: 400, headers: CORS },
          );
        }
        const attachments: Array<{ path: string; name: string; size: number; type: string }> = [];
        for (const file of files) {
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
          const path = `${ticket.tenant_id}/${ticket.id}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
          const buf = new Uint8Array(await file.arrayBuffer());
          const { error: upErr } = await supabaseAdmin.storage
            .from("ticket-attachments")
            .upload(path, buf, {
              contentType: file.type || "application/octet-stream",
              upsert: false,
            });
          if (upErr) {
            if (attachments.length > 0) {
              await supabaseAdmin.storage
                .from("ticket-attachments")
                .remove(attachments.map((attachment) => attachment.path));
            }
            return Response.json(
              { error: "upload_failed", detail: upErr.message },
              { status: 500, headers: CORS },
            );
          }
          attachments.push({
            path,
            name: file.name,
            size: file.size,
            type: file.type || "application/octet-stream",
          });
        }

        const { data: msg, error: msgErr } = await supabaseAdmin
          .from("messages")
          .insert({
            tenant_id: ticket.tenant_id,
            ticket_id: ticket.id,
            author_type: "contact",
            author_contact_id: session.contact_id,
            content:
              content ||
              `${attachments.length === 1 ? "Anexo enviado" : `${attachments.length} anexos enviados`}.`,
            is_internal: false,
            channel: ticket.channel === "chat" ? "chat" : "portal",
            attachments,
          })
          .select("id")
          .single();
        if (msgErr) {
          if (attachments.length > 0) {
            await supabaseAdmin.storage
              .from("ticket-attachments")
              .remove(attachments.map((attachment) => attachment.path));
          }
          return Response.json(
            { error: "message_failed", detail: msgErr.message },
            { status: 500, headers: CORS },
          );
        }

        const keepActiveAttendance = ticket.channel === "chat" && ticket.status === "in_progress";
        await supabaseAdmin
          .from("tickets")
          .update(
            keepActiveAttendance
              ? { updated_at: new Date().toISOString() }
              : {
                  status: "pending",
                  pending_type: "awaiting_tech",
                  updated_at: new Date().toISOString(),
                },
          )
          .eq("id", ticket.id);

        return Response.json({ ok: true, message_id: msg.id }, { status: 200, headers: CORS });
      },
    },
  },
});
