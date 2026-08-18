import { createFileRoute } from "@tanstack/react-router";
import { secureEquals } from "@/lib/secure-compare";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/rate-limit";

/**
 * Triggers one IMAP poll pass across every tenant with the email channel
 * enabled (src/lib/imap-poll.server.ts) — the pull-based counterpart to the
 * push-based /api/public/hooks/uazapi/$tenantId webhook.
 *
 * Auth: header `Authorization: Bearer <EMAIL_INGEST_SECRET>` (same secret as
 * the manual email-ingest webhook — both are internal "email channel"
 * triggers, no need for a second secret).
 *
 * Ops: scheduled every MINUTE via pg_cron + pg_net on the Postgres side —
 * that's the finest cron granularity available. The actual per-tenant cadence
 * is enforced inside pollAllTenants() using tenants.email_poll_interval_minutes
 * / tenants.email_last_polled_at (configurable per tenant in
 * Configurações → Canais → E-mail), so a tenant set to "every 10 min" only
 * really gets IMAP-polled 1 out of every 10 ticks here, not every one:
 *
 *   select cron.schedule(
 *     'email-imap-poll',
 *     '* * * * *',
 *     $$
 *     select net.http_post(
 *       url := '<PUBLIC_APP_URL>/api/public/hooks/email-imap-poll',
 *       headers := jsonb_build_object(
 *         'Authorization', 'Bearer <EMAIL_INGEST_SECRET>',
 *         'Content-Type', 'application/json'
 *       ),
 *       body := '{}'::jsonb
 *     );
 *     $$
 *   );
 *
 * Can also be called manually (e.g. curl) to force an immediate poll pass
 * (still subject to each tenant's own interval — use the "Sincronizar agora"
 * button / syncTenantMailbox server function to bypass that for one tenant).
 */
export const Route = createFileRoute("/api/public/hooks/email-imap-poll")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = clientIp(request);
        const ipLimit = checkRateLimit(`email-imap-poll:ip:${ip}`, 30, 5 * 60 * 1000);
        if (!ipLimit.allowed) return rateLimitedResponse(ipLimit.retryAfterSeconds);

        const secret = process.env.EMAIL_INGEST_SECRET;
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.replace(/^Bearer\s+/i, "").trim();
        if (!secret || !token || !secureEquals(token, secret)) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }

        const { pollAllTenants } = await import("@/lib/imap-poll.server");
        const results = await pollAllTenants();

        const summary = {
          tenants_polled: results.length,
          created: results.reduce((sum, r) => sum + r.created, 0),
          duplicates: results.reduce((sum, r) => sum + r.duplicates, 0),
          skipped: results.reduce((sum, r) => sum + r.skipped, 0),
          errors: results.flatMap((r) => r.errors.map((e) => `${r.tenant_id}: ${e}`)),
        };

        if (summary.errors.length) {
          console.error("[email-imap-poll] errors during poll", summary.errors);
        }

        return Response.json({ ok: true, ...summary }, { status: 200 });
      },
    },
  },
});
