// Server-only. Polls each tenant's own IMAP inbox for unread mail and hands
// each message to the same ticket-opening logic used by the manual webhook
// (src/lib/email-channel.server.ts) — this is the "email channel", the
// receiving counterpart to the WhatsApp/UAZAPI channel
// (src/routes/api/public/hooks/uazapi/$tenantId.ts), just pull instead of
// push since generic IMAP has no webhook mechanism.
//
// Triggered by POST /api/public/hooks/email-imap-poll, which is in turn
// scheduled by pg_cron EVERY MINUTE (the finest cron granularity) via
// pg_net — see the ops note in that route file for the exact
// `cron.schedule` call. Each tenant sets its own effective cadence via
// tenants.email_poll_interval_minutes (Configurações → Canais → E-mail);
// pollAllTenants() below only actually polls a tenant once that many
// minutes have passed since tenants.email_last_polled_at.
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { processInboundEmail } from "@/lib/email-channel.server";

export type TenantMailbox = {
  id: string;
  email_imap_host: string;
  email_imap_port: number;
  email_imap_user: string;
  email_imap_password: string;
  email_imap_secure: boolean;
};

export type TenantPollResult = {
  tenant_id: string;
  processed: number;
  created: number;
  skipped: number;
  duplicates: number;
  errors: string[];
};

const MAX_MESSAGES_PER_POLL = 50; // safety cap per tenant per run
const CONNECT_TIMEOUT_MS = 15_000;

export async function pollTenantMailbox(tenant: TenantMailbox): Promise<TenantPollResult> {
  const result: TenantPollResult = {
    tenant_id: tenant.id,
    processed: 0,
    created: 0,
    skipped: 0,
    duplicates: 0,
    errors: [],
  };

  const client = new ImapFlow({
    host: tenant.email_imap_host,
    port: tenant.email_imap_port,
    secure: tenant.email_imap_secure,
    auth: { user: tenant.email_imap_user, pass: tenant.email_imap_password },
    logger: false,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: CONNECT_TIMEOUT_MS,
  });

  try {
    await client.connect();
  } catch (err) {
    result.errors.push(`connect_failed: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      const batch = (uids || []).slice(0, MAX_MESSAGES_PER_POLL);

      for (const uid of batch) {
        try {
          const msg = await client.fetchOne(
            String(uid),
            { source: true, uid: true },
            { uid: true },
          );
          if (!msg || !msg.source) continue;

          const parsed = await simpleParser(msg.source);
          const fromAddress = parsed.from?.value?.[0]?.address;
          if (!fromAddress) {
            // Can't attribute this message to a contact — leave unread for manual triage,
            // don't mark \Seen so it doesn't silently vanish.
            continue;
          }

          const messageId = parsed.messageId || `imap-${tenant.id}-${uid}`;
          const attachments = (parsed.attachments ?? []).map((a) => ({
            filename: a.filename || `anexo-${Date.now()}`,
            contentType: a.contentType || "application/octet-stream",
            size: a.size ?? a.content.length,
            content: a.content,
          }));
          const outcome = await processInboundEmail({
            message_id: messageId,
            from_email: fromAddress,
            from_name: parsed.from?.value?.[0]?.name ?? null,
            subject: parsed.subject || "(sem assunto)",
            body: parsed.text || parsed.html || "",
            tenant_id: tenant.id,
            attachments,
          });

          result.processed += 1;
          if (outcome.status === "created") result.created += 1;
          else if (outcome.status === "duplicate") result.duplicates += 1;
          else if (outcome.status === "skipped") result.skipped += 1;
          else result.errors.push(`uid ${uid}: ${outcome.reason}`);

          // Mark handled regardless of created/duplicate/skipped so we don't
          // reprocess it forever — only a transport/DB error skips this,
          // letting the next poll retry.
          if (outcome.status !== "error") {
            await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
          }
        } catch (err) {
          result.errors.push(`uid ${uid}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    result.errors.push(`mailbox_error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }

  return result;
}

export async function pollAllTenants(): Promise<TenantPollResult[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: tenants, error } = await supabaseAdmin
    .from("tenants")
    .select(
      "id, email_imap_host, email_imap_port, email_imap_user, email_imap_password, email_imap_secure, email_poll_interval_minutes, email_last_polled_at",
    )
    .eq("email_enabled", true)
    .not("email_imap_host", "is", null)
    .not("email_imap_user", "is", null)
    .not("email_imap_password", "is", null);

  if (error) {
    console.error("[imap-poll] failed to load tenants", error);
    return [];
  }

  const now = Date.now();
  const eligible = (tenants ?? []).filter(
    (
      t,
    ): t is TenantMailbox & {
      email_poll_interval_minutes: number;
      email_last_polled_at: string | null;
    } => {
      if (!t.email_imap_host || !t.email_imap_user || !t.email_imap_password) return false;
      if (!t.email_last_polled_at) return true; // never polled — always due
      const intervalMs = (t.email_poll_interval_minutes ?? 5) * 60_000;
      const elapsedMs = now - new Date(t.email_last_polled_at).getTime();
      return elapsedMs >= intervalMs;
    },
  );

  // Sequential on purpose: keeps concurrent IMAP connections (and load on
  // whatever mail servers tenants point at) bounded and predictable.
  const results: TenantPollResult[] = [];
  for (const tenant of eligible) {
    const result = await pollTenantMailbox(tenant);
    results.push(result);
    await supabaseAdmin
      .from("tenants")
      .update({ email_last_polled_at: new Date().toISOString() })
      .eq("id", tenant.id);
  }
  return results;
}
