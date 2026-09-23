import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/rate-limit";
import { verifyPortalRequest } from "@/lib/portal-session";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const ContactFields = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(255),
  phone: z.string().trim().max(40).nullable().optional(),
  job_title: z.string().trim().max(120).nullable().optional(),
  can_open_tickets: z.boolean(),
  receives_csat: z.boolean(),
  is_portal_admin: z.boolean(),
  is_portal_financial: z.boolean(),
  is_active: z.boolean(),
});
const UpdateSchema = ContactFields.extend({ id: z.string().uuid() });

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function portalAdmin(request: Request) {
  const session = verifyPortalRequest(request);
  if (!session) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("id,tenant_id,company_id,is_active,is_portal_admin")
    .eq("id", session.contact_id)
    .eq("tenant_id", session.tenant_id)
    .maybeSingle();
  return data?.is_active && data.is_portal_admin && data.company_id
    ? { actor: data, supabaseAdmin }
    : null;
}

export const Route = createFileRoute("/api/public/portal/contacts")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const limit = checkRateLimit(
          `portal-contacts-list:${clientIp(request)}`,
          60,
          10 * 60 * 1000,
        );
        if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds, CORS);
        const context = await portalAdmin(request);
        if (!context) return Response.json({ error: "forbidden" }, { status: 403, headers: CORS });
        const { data, error } = await context.supabaseAdmin
          .from("contacts")
          .select(
            "id,name,email,phone,job_title,can_open_tickets,receives_csat,is_portal_admin,is_portal_financial,is_active",
          )
          .eq("tenant_id", context.actor.tenant_id)
          .eq("company_id", context.actor.company_id)
          .order("name");
        if (error) return Response.json({ error: "query_failed" }, { status: 500, headers: CORS });
        return Response.json({ contacts: data ?? [] }, { headers: CORS });
      },
      POST: async ({ request }) => {
        const limit = checkRateLimit(
          `portal-contacts-create:${clientIp(request)}`,
          20,
          10 * 60 * 1000,
        );
        if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds, CORS);
        const context = await portalAdmin(request);
        if (!context) return Response.json({ error: "forbidden" }, { status: 403, headers: CORS });
        const parsed = ContactFields.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json({ error: "invalid_payload" }, { status: 400, headers: CORS });

        const { data: duplicate } = await context.supabaseAdmin
          .from("contacts")
          .select("id")
          .eq("tenant_id", context.actor.tenant_id)
          .eq("company_id", context.actor.company_id)
          .ilike("email", parsed.data.email)
          .limit(1)
          .maybeSingle();
        if (duplicate)
          return Response.json({ error: "email_exists" }, { status: 409, headers: CORS });

        const { data, error } = await context.supabaseAdmin
          .from("contacts")
          .insert({
            ...parsed.data,
            phone: parsed.data.phone || null,
            job_title: parsed.data.job_title || null,
            tenant_id: context.actor.tenant_id,
            company_id: context.actor.company_id,
          })
          .select("id")
          .single();
        if (error) return Response.json({ error: "create_failed" }, { status: 422, headers: CORS });

        let invited = true;
        try {
          const { sendMail } = await import("@/lib/mailer.server");
          const portalUrl = new URL("/portal", request.url).toString();
          await sendMail({
            to: parsed.data.email,
            subject: "Seu acesso ao Portal do Cliente APTicket",
            text: `Olá, ${parsed.data.name}. Seu acesso foi criado. Entre em ${portalUrl} e use o código de acesso enviado ao seu e-mail.`,
            html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#172033"><h2>Seu acesso ao APTicket foi criado</h2><p>Olá, ${escapeHtml(parsed.data.name)}.</p><p>Acesse o Portal do Cliente e informe seu e-mail. Enviaremos um código seguro para concluir o acesso.</p><p><a href="${portalUrl}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#0f6f8d;color:#fff;text-decoration:none">Acessar portal</a></p></div>`,
          });
        } catch (error) {
          invited = false;
          console.error("[portal/contacts] invite error", error);
        }
        return Response.json({ id: data.id, invited }, { status: 201, headers: CORS });
      },
      PATCH: async ({ request }) => {
        const limit = checkRateLimit(
          `portal-contacts-update:${clientIp(request)}`,
          40,
          10 * 60 * 1000,
        );
        if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds, CORS);
        const context = await portalAdmin(request);
        if (!context) return Response.json({ error: "forbidden" }, { status: 403, headers: CORS });
        const parsed = UpdateSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json({ error: "invalid_payload" }, { status: 400, headers: CORS });
        if (parsed.data.id === context.actor.id && !parsed.data.is_active) {
          return Response.json({ error: "cannot_deactivate_self" }, { status: 409, headers: CORS });
        }
        if (parsed.data.id === context.actor.id && !parsed.data.is_portal_admin) {
          return Response.json(
            { error: "cannot_remove_own_admin" },
            { status: 409, headers: CORS },
          );
        }
        const { id, ...values } = parsed.data;
        const { data: duplicate } = await context.supabaseAdmin
          .from("contacts")
          .select("id")
          .eq("tenant_id", context.actor.tenant_id)
          .eq("company_id", context.actor.company_id)
          .ilike("email", values.email)
          .neq("id", id)
          .limit(1)
          .maybeSingle();
        if (duplicate) {
          return Response.json({ error: "email_exists" }, { status: 409, headers: CORS });
        }
        const { data, error } = await context.supabaseAdmin
          .from("contacts")
          .update({ ...values, phone: values.phone || null, job_title: values.job_title || null })
          .eq("id", id)
          .eq("tenant_id", context.actor.tenant_id)
          .eq("company_id", context.actor.company_id)
          .select("id")
          .maybeSingle();
        if (error || !data)
          return Response.json({ error: "update_failed" }, { status: 422, headers: CORS });
        return Response.json({ ok: true }, { headers: CORS });
      },
    },
  },
});
