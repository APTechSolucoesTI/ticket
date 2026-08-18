import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;
}

/* ============================================================
 * Test IMAP connection — same shape as testUazapiConnection in
 * whatsapp.functions.ts: accepts override values so the UI can test before
 * saving, falls back to the tenant's already-saved credentials otherwise.
 * ============================================================ */
export const testImapConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        host: z.string().min(1).optional(),
        port: z.number().int().min(1).max(65535).optional(),
        user: z.string().min(1).optional(),
        password: z.string().min(1).optional(),
        secure: z.boolean().optional(),
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

    let { host, port, user, password, secure } = data;
    if (!host || !user || !password) {
      const { data: t } = await supabase
        .from("tenants")
        .select(
          "email_imap_host, email_imap_port, email_imap_user, email_imap_password, email_imap_secure",
        )
        .eq("id", profile.tenant_id)
        .maybeSingle();
      host = host ?? t?.email_imap_host ?? undefined;
      port = port ?? t?.email_imap_port ?? undefined;
      user = user ?? t?.email_imap_user ?? undefined;
      password = password ?? t?.email_imap_password ?? undefined;
      secure = secure ?? t?.email_imap_secure ?? undefined;
    }
    if (!host || !user || !password) {
      return { ok: false as const, message: "Informe servidor, usuário e senha." };
    }

    const { ImapFlow } = await import("imapflow");
    const client = new ImapFlow({
      host,
      port: port ?? 993,
      secure: secure ?? true,
      auth: { user, pass: password },
      logger: false,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
    });

    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      let exists = 0;
      try {
        const status = await client.status("INBOX", { messages: true, unseen: true });
        exists = status.messages ?? 0;
        return {
          ok: true as const,
          message: `Conectado. ${status.unseen ?? 0} não lida(s) de ${exists} na caixa.`,
        };
      } finally {
        lock.release();
      }
    } catch (err) {
      return {
        ok: false as const,
        message: err instanceof Error ? err.message : "Falha ao conectar ao IMAP.",
      };
    } finally {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    }
  });

/* ============================================================
 * Manual sync — runs one IMAP poll pass for the caller's own tenant right
 * now, instead of waiting for the tenant's own automatic interval
 * (tenants.email_poll_interval_minutes). Used by the "Sincronizar agora"
 * button on the "Fila de E-mail" screen.
 * ============================================================ */
export const syncTenantMailbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (!profile?.tenant_id) throw new Error("Tenant não encontrado");

    const { data: tenant } = await supabase
      .from("tenants")
      .select(
        "id, email_imap_host, email_imap_port, email_imap_user, email_imap_password, email_imap_secure",
      )
      .eq("id", profile.tenant_id)
      .maybeSingle();

    // Intentionally does NOT require email_enabled: that flag only gates the
    // automatic pg_cron poll (src/lib/imap-poll.server.ts pollAllTenants).
    // A manual "Sincronizar agora" click is an explicit request — it should
    // run as long as IMAP credentials exist, whether or not auto-poll is on.
    if (!tenant?.email_imap_host || !tenant.email_imap_user || !tenant.email_imap_password) {
      throw new Error("Configure o IMAP em Configurações → Canais → E-mail antes de sincronizar.");
    }

    const { pollTenantMailbox } = await import("@/lib/imap-poll.server");
    const result = await pollTenantMailbox({
      id: tenant.id,
      email_imap_host: tenant.email_imap_host,
      email_imap_port: tenant.email_imap_port,
      email_imap_user: tenant.email_imap_user,
      email_imap_password: tenant.email_imap_password,
      email_imap_secure: tenant.email_imap_secure,
    });
    // Push out the automatic-poll clock too, so a manual sync doesn't get
    // immediately followed by a redundant automatic one a minute later.
    await supabase
      .from("tenants")
      .update({ email_last_polled_at: new Date().toISOString() })
      .eq("id", tenant.id);
    return result;
  });

/* ============================================================
 * Send an email reply — the "Responder ao Cliente" action on an
 * email-origin ticket. Mirrors sendWhatsAppReply in whatsapp.functions.ts:
 * looks up the ticket + contact via the caller's RLS-scoped client, sends
 * through the tenant's own SMTP account, then logs the message row.
 * ============================================================ */
export const sendEmailReply = createServerFn({ method: "POST" })
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
      .select("id, tenant_id, subject, channel, contact_id, contacts(email, name)")
      .eq("id", data.ticket_id)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!ticket) throw new Error("Ticket não encontrado");
    if (ticket.channel !== "email") throw new Error("Ticket não é de origem e-mail");

    const contactEmail = (ticket as { contacts?: { email?: string | null } | null }).contacts
      ?.email;
    if (!contactEmail) throw new Error("Contato sem e-mail cadastrado");

    const { data: tenant } = await supabase
      .from("tenants")
      .select(
        "name, email_imap_user, email_imap_password, email_smtp_host, email_smtp_port, email_smtp_secure",
      )
      .eq("id", ticket.tenant_id)
      .maybeSingle();
    if (!tenant?.email_smtp_host || !tenant.email_imap_user || !tenant.email_imap_password) {
      throw new Error(
        "Configure o envio (SMTP) em Configurações → Canais → E-mail antes de responder.",
      );
    }

    // Thread the reply under the last inbound message, if it carried a
    // Message-ID, so it lands in the same conversation in the customer's inbox.
    const { data: lastInbound } = await supabase
      .from("messages")
      .select("external_id")
      .eq("ticket_id", ticket.id)
      .eq("channel", "email")
      .eq("author_type", "contact")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { sendTenantEmail } = await import("@/lib/email-send.server");
    let externalId: string | null = null;
    try {
      const sent = await sendTenantEmail(
        {
          host: tenant.email_smtp_host,
          port: tenant.email_smtp_port,
          secure: tenant.email_smtp_secure,
          user: tenant.email_imap_user,
          password: tenant.email_imap_password,
          fromName: tenant.name,
        },
        {
          to: contactEmail,
          subject: replySubject(ticket.subject),
          text: data.content,
          inReplyTo: lastInbound?.external_id ?? null,
          references: lastInbound?.external_id ?? null,
        },
      );
      externalId = sent.messageId;
    } catch (err) {
      throw new Error(
        `Falha ao enviar e-mail: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const { data: inserted, error: msgErr } = await supabase
      .from("messages")
      .insert({
        tenant_id: ticket.tenant_id,
        ticket_id: ticket.id,
        author_id: userId,
        author_type: "agent",
        channel: "email",
        is_internal: false,
        content: data.content,
        external_id: externalId,
      })
      .select("id")
      .single();
    if (msgErr) throw msgErr;

    return { ok: true as const, message_id: inserted.id };
  });
