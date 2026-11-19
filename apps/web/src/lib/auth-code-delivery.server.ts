import { sendMail } from "./mailer.server";

type Recipient = { id: string; tenant_id: string; email: string | null; phone: string | null };

export async function deliverAuthCode(recipient: Recipient, code: string): Promise<boolean> {
  const text = `Seu código de acesso ao APTicket é ${code}. Ele expira em 10 minutos. Se você não solicitou, ignore esta mensagem.`;
  const deliveries: Promise<boolean>[] = [];
  if (recipient.email) {
    deliveries.push(
      sendMail({
        to: recipient.email,
        subject: "Código de acesso ao APTicket",
        text,
        html: `<p>Seu código de acesso ao APTicket é <strong>${code}</strong>.</p><p>Ele expira em 10 minutos. Se você não solicitou, ignore esta mensagem.</p>`,
      }).then((result) => Array.isArray(result.accepted) && result.accepted.length > 0),
    );
  }
  if (recipient.phone) {
    deliveries.push(sendWhatsappCode(recipient, code));
  }
  const results = await Promise.allSettled(deliveries);
  return results.some((result) => result.status === "fulfilled" && result.value);
}

async function sendWhatsappCode(recipient: Recipient, code: string): Promise<boolean> {
  const base = process.env.INTERNAL_BACKEND_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return false;
  const response = await fetch(new URL("/channels/whatsapp/internal-auth-code", base), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-apticket-internal-key": key },
    body: JSON.stringify({ tenantId: recipient.tenant_id, contactId: recipient.id, code }),
    signal: AbortSignal.timeout(12_000),
    redirect: "error",
  });
  return response.ok;
}
