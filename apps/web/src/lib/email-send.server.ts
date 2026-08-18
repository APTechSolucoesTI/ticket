// Server-only. Outbound SMTP for the email channel — the sending half,
// paired with the receiving half in imap-poll.server.ts /
// email-channel.server.ts. Reuses the tenant's own mailbox account
// (email_imap_user/email_imap_password) as SMTP auth against
// email_smtp_host/port/secure — the common "same account for IMAP and SMTP"
// setup. Configured per tenant in Configurações → Canais → E-mail.
import nodemailer from "nodemailer";

export type TenantSmtp = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromName?: string | null;
};

export async function sendTenantEmail(
  smtp: TenantSmtp,
  opts: {
    to: string;
    subject: string;
    text: string;
    inReplyTo?: string | null;
    references?: string | null;
  },
): Promise<{ messageId: string | null }> {
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.password },
  });

  const from = smtp.fromName ? `${smtp.fromName} <${smtp.user}>` : smtp.user;

  const info = await transporter.sendMail({
    from,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    inReplyTo: opts.inReplyTo ?? undefined,
    references: opts.references ?? undefined,
  });

  return { messageId: info.messageId ?? null };
}
