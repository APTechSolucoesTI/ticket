import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/rate-limit";
import { verifyPortalRequest } from "@/lib/portal-session";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 5;

const Schema = z.object({
  subject: z.string().min(3).max(500),
  description: z.string().min(1).max(10000),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  equipment_ids: z.array(z.string().uuid()).optional(),
  contract_id: z.string().uuid().optional(),
});

export const Route = createFileRoute("/api/public/portal/tickets")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const ip = clientIp(request);
        const ipLimit = checkRateLimit(`portal-tickets:ip:${ip}`, 30, 10 * 60 * 1000);
        if (!ipLimit.allowed) return rateLimitedResponse(ipLimit.retryAfterSeconds, CORS);

        const session = verifyPortalRequest(request);
        if (!session) {
          return Response.json({ error: "unauthorized" }, { status: 401, headers: CORS });
        }

        const contentType = request.headers.get("content-type") ?? "";
        let raw: Record<string, unknown> = {};
        let files: File[] = [];

        if (contentType.includes("multipart/form-data")) {
          let form: FormData;
          try {
            form = await request.formData();
          } catch {
            return Response.json({ error: "invalid_form" }, { status: 400, headers: CORS });
          }
          raw = {
            subject: String(form.get("subject") ?? ""),
            description: String(form.get("description") ?? ""),
            priority: (form.get("priority") as string) || undefined,
            equipment_ids: form.getAll("equipment_ids").map(String).filter(Boolean),
            contract_id: (form.get("contract_id") as string) || undefined,
          };
          files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
        } else {
          try {
            raw = (await request.json()) as Record<string, unknown>;
          } catch {
            return Response.json({ error: "invalid_json" }, { status: 400, headers: CORS });
          }
        }

        const parsed = Schema.safeParse(raw);
        if (!parsed.success) {
          return Response.json(
            { error: "invalid_payload", issues: parsed.error.issues },
            { status: 400, headers: CORS },
          );
        }
        const data = parsed.data;

        if (files.length > MAX_FILES) {
          return Response.json({ error: "too_many_files" }, { status: 400, headers: CORS });
        }
        for (const f of files) {
          if (f.size > MAX_FILE_BYTES) {
            return Response.json(
              { error: "file_too_large", name: f.name },
              { status: 400, headers: CORS },
            );
          }
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: contact } = await supabaseAdmin
          .from("contacts")
          .select("id, tenant_id, company_id, can_open_tickets, is_active")
          .eq("id", session.contact_id)
          .eq("tenant_id", session.tenant_id)
          .maybeSingle();

        if (!contact || !contact.company_id) {
          return Response.json({ error: "unknown_contact" }, { status: 403, headers: CORS });
        }
        if (contact.is_active === false || contact.can_open_tickets === false) {
          return Response.json({ error: "contact_not_allowed" }, { status: 403, headers: CORS });
        }

        const { data: contracts } = await supabaseAdmin
          .from("contracts")
          .select(
            "id, sla_policy_id, includes_remote, includes_lab, includes_onsite, contract_equipments(equipment_id)",
          )
          .eq("tenant_id", contact.tenant_id)
          .eq("company_id", contact.company_id)
          .eq("status", "active")
          .order("starts_at", { ascending: false });

        const eligible = (contracts ?? []).filter(
          (c) => c.includes_remote || c.includes_lab || c.includes_onsite,
        );
        const contract = data.contract_id
          ? eligible.find((c) => c.id === data.contract_id)
          : eligible[0];

        if (!contract) {
          return Response.json({ error: "no_active_contract" }, { status: 403, headers: CORS });
        }

        const contractEquipmentIds: string[] = (
          (contract as { contract_equipments?: { equipment_id: string }[] }).contract_equipments ??
          []
        ).map((e) => e.equipment_id);
        const restrictsEquipments = contractEquipmentIds.length > 0;

        const { data: ticket, error: tErr } = await supabaseAdmin
          .from("tickets")
          .insert({
            tenant_id: contact.tenant_id,
            subject: data.subject,
            status: "new",
            priority: data.priority ?? "medium",
            channel: "portal",
            contact_id: contact.id,
            company_id: contact.company_id,
            contract_id: contract.id,
            sla_policy_id: contract.sla_policy_id ?? null,
            pending_type: "awaiting_tech",
          })
          .select("id, number")
          .single();

        if (tErr || !ticket) {
          console.error("[portal/tickets] insert error", tErr);
          return Response.json({ error: "insert_failed" }, { status: 500, headers: CORS });
        }

        const attachments: Array<{ path: string; name: string; size: number; type: string }> = [];
        for (const file of files) {
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
          const path = `${contact.tenant_id}/${ticket.id}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
          const buf = new Uint8Array(await file.arrayBuffer());
          const { error: upErr } = await supabaseAdmin.storage
            .from("ticket-attachments")
            .upload(path, buf, {
              contentType: file.type || "application/octet-stream",
              upsert: false,
            });
          if (upErr) {
            console.error("[portal/tickets] upload error", upErr);
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

        await supabaseAdmin.from("messages").insert({
          tenant_id: contact.tenant_id,
          ticket_id: ticket.id,
          author_contact_id: contact.id,
          author_type: "contact",
          channel: "portal",
          is_internal: false,
          content: data.description,
          attachments,
        });

        if (data.equipment_ids && data.equipment_ids.length > 0) {
          let eqQuery = supabaseAdmin
            .from("equipments")
            .select("id")
            .eq("tenant_id", contact.tenant_id)
            .eq("company_id", contact.company_id)
            .in("id", data.equipment_ids);
          if (restrictsEquipments) {
            eqQuery = eqQuery.in("id", contractEquipmentIds);
          }
          const { data: validEq } = await eqQuery;
          const ids = (validEq ?? []).map((e) => e.id);
          if (ids.length > 0) {
            await supabaseAdmin.from("ticket_equipments").insert(
              ids.map((eid) => ({
                tenant_id: contact.tenant_id,
                ticket_id: ticket.id,
                equipment_id: eid,
              })),
            );
            await supabaseAdmin
              .from("tickets")
              .update({ equipment_id: ids[0] })
              .eq("id", ticket.id);
          }
        }

        return Response.json(
          { status: "created", ticket_id: ticket.id, number: ticket.number },
          { status: 201, headers: CORS },
        );
      },
    },
  },
});
