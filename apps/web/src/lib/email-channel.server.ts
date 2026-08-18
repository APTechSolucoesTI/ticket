// Server-only. Shared "inbound email -> ticket" business logic — same rules
// used by both the manual /api/public/hooks/email-ingest webhook and the
// IMAP poller (src/lib/imap-poll.server.ts). Kept in one place so the two
// entry points can never drift apart.
//
// Regra de negócio: o e-mail só vira ticket se existir um contato com aquele
// e-mail cadastrado e a empresa do contato possuir contrato ATIVO.
//
// Unknown/blocked-less/no-contract senders are queued into
// public.email_pending_messages — the "Fila de E-mail" screen — mirroring
// how the WhatsApp/UAZAPI channel auto-creates a pending contact and queues
// the message (src/routes/api/public/hooks/uazapi/$tenantId.ts). Queueing
// only happens when `tenant_id` is known (the IMAP poller always knows which
// tenant's mailbox it's reading); the manual webhook has no tenant context
// for a first-time sender, so it just skips as before.

export type InboundEmailAttachment = {
  filename: string;
  contentType: string;
  size: number;
  content: Buffer;
};

export type StoredAttachment = { path: string; name: string; size: number; type: string };

export type InboundEmail = {
  message_id: string;
  from_email: string;
  from_name?: string | null;
  subject: string;
  body: string;
  /** Known when polling a specific tenant's own mailbox (IMAP poller). */
  tenant_id?: string;
  attachments?: InboundEmailAttachment[];
};

export type InboundEmailResult =
  | { status: "created"; ticket_id: string; number: number }
  | { status: "duplicate"; ticket_id: string | null }
  | { status: "skipped"; reason: "unknown_contact" | "contact_not_allowed" | "no_active_contract" }
  | { status: "error"; reason: string };

async function uploadAttachments(
  supabaseAdmin: import("@supabase/supabase-js").SupabaseClient<
    import("@/integrations/supabase/types").Database,
    "apticket"
  >,
  basePath: string,
  attachments: InboundEmailAttachment[],
): Promise<StoredAttachment[]> {
  const uploaded: StoredAttachment[] = [];
  for (const att of attachments) {
    const safeName = (att.filename || "anexo").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
    const path = `${basePath}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
    const { error } = await supabaseAdmin.storage
      .from("ticket-attachments")
      .upload(path, att.content, {
        contentType: att.contentType || "application/octet-stream",
        upsert: false,
      });
    if (error) {
      console.error("[email-channel] attachment upload failed", error);
      continue;
    }
    uploaded.push({
      path,
      name: att.filename || safeName,
      size: att.size,
      type: att.contentType || "application/octet-stream",
    });
  }
  return uploaded;
}

async function queuePendingEmail(params: {
  tenantId: string;
  contactId: string;
  data: InboundEmail;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const id = crypto.randomUUID();
  const attachments = params.data.attachments?.length
    ? await uploadAttachments(
        supabaseAdmin,
        `${params.tenantId}/pending/${id}`,
        params.data.attachments,
      )
    : [];

  const { error } = await supabaseAdmin.from("email_pending_messages").insert({
    id,
    tenant_id: params.tenantId,
    contact_id: params.contactId,
    from_email: params.data.from_email,
    from_name: params.data.from_name ?? null,
    subject: params.data.subject,
    content: params.data.body || "(sem conteúdo)",
    message_id: params.data.message_id,
    attachments,
  });
  if (error) {
    console.error("[email-channel] pending queue insert error", error);
  }
}

export async function processInboundEmail(data: InboundEmail): Promise<InboundEmailResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // 1) Localiza contato pelo e-mail (case-insensitive)
  const { data: contact, error: contactErr } = await supabaseAdmin
    .from("contacts")
    .select("id, tenant_id, company_id, name, can_open_tickets, is_active")
    .ilike("email", data.from_email)
    .maybeSingle();

  if (contactErr) {
    console.error("[email-channel] contact lookup error", contactErr);
    return { status: "error", reason: "db_error" };
  }

  if (!contact) {
    // Never seen this sender before. Auto-create a pending contact (same
    // pattern as the WhatsApp channel) so an agent can triage it in the
    // "Fila de E-mail" — but only when we know which tenant's mailbox this
    // came through.
    if (data.tenant_id) {
      const { data: newContact, error: cErr } = await supabaseAdmin
        .from("contacts")
        .insert({
          tenant_id: data.tenant_id,
          company_id: null,
          name: data.from_name?.trim() || data.from_email,
          email: data.from_email,
          is_active: true,
          can_open_tickets: false,
          notes: "Contato criado automaticamente via e-mail — aguardando vínculo com cliente.",
        })
        .select("id")
        .single();
      if (cErr || !newContact) {
        console.error("[email-channel] create pending contact failed", cErr);
      } else {
        await queuePendingEmail({ tenantId: data.tenant_id, contactId: newContact.id, data });
      }
    }
    return { status: "skipped", reason: "unknown_contact" };
  }

  if (!contact.company_id) {
    // Already a pending contact (created here or via another channel) —
    // still not linked to a client. Queue this message under it too.
    await queuePendingEmail({ tenantId: contact.tenant_id, contactId: contact.id, data });
    return { status: "skipped", reason: "unknown_contact" };
  }

  if (contact.is_active === false || contact.can_open_tickets === false) {
    // Blocked on purpose — do not re-queue, that would defeat the block.
    return { status: "skipped", reason: "contact_not_allowed" };
  }

  // 2) Exige contrato ativo
  const { data: contractRow } = await supabaseAdmin
    .from("contracts")
    .select("id, sla_policy_id")
    .eq("tenant_id", contact.tenant_id)
    .eq("company_id", contact.company_id)
    .eq("status", "active")
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!contractRow) {
    await queuePendingEmail({ tenantId: contact.tenant_id, contactId: contact.id, data });
    return { status: "skipped", reason: "no_active_contract" };
  }

  // 3) Deduplicação por Message-ID (procura nos últimos 7 dias)
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: existingMsg } = await supabaseAdmin
    .from("messages")
    .select("id, ticket_id")
    .eq("tenant_id", contact.tenant_id)
    .eq("channel", "email")
    .gte("created_at", since)
    .eq("external_id", data.message_id)
    .maybeSingle();

  if (existingMsg) {
    return { status: "duplicate", ticket_id: existingMsg.ticket_id };
  }

  // 4) Cria ticket
  const { data: ticket, error: ticketErr } = await supabaseAdmin
    .from("tickets")
    .insert({
      tenant_id: contact.tenant_id,
      subject: data.subject,
      status: "new",
      priority: "medium",
      channel: "email",
      contact_id: contact.id,
      company_id: contact.company_id,
      contract_id: contractRow.id,
      sla_policy_id: contractRow.sla_policy_id ?? null,
      pending_type: "awaiting_tech",
    })
    .select("id, number")
    .single();

  if (ticketErr || !ticket) {
    console.error("[email-channel] ticket insert error", ticketErr);
    return { status: "error", reason: "ticket_insert_failed" };
  }

  // 5) Mensagem inicial com o corpo do e-mail (message_id vai em external_id p/ dedup)
  const attachments = data.attachments?.length
    ? await uploadAttachments(supabaseAdmin, `${contact.tenant_id}/${ticket.id}`, data.attachments)
    : [];

  const { error: msgErr } = await supabaseAdmin.from("messages").insert({
    tenant_id: contact.tenant_id,
    ticket_id: ticket.id,
    author_contact_id: contact.id,
    author_type: "contact",
    channel: "email",
    is_internal: false,
    content: data.body || "(sem conteúdo)",
    external_id: data.message_id,
    attachments,
  });

  if (msgErr) {
    console.error("[email-channel] message insert error", msgErr);
  }

  return { status: "created", ticket_id: ticket.id, number: ticket.number };
}
