// Server-only. Sends transactional email for the customer portal (OTP codes).
// Separate from GoTrue's own mailer - this is used for portal_otp_codes delivery,
// which is app-level (contacts are not Supabase Auth users).
import nodemailer, { type SentMessageInfo, type Transporter } from "nodemailer";

let _transporter: Transporter | undefined;

/** Hostname público anunciado no EHLO/HELO. Em containers, o hostname do
 * sistema normalmente não é um FQDN e o Nodemailer recua para [127.0.0.1],
 * valor bloqueado pelo filtro SMTP da HostGator. */
export function getSmtpClientName(): string {
  const configured = process.env.SMTP_CLIENT_NAME?.trim().toLowerCase();
  if (configured) return configured;
  try {
    const publicHostname = new URL(process.env.PUBLIC_SITE_URL ?? "").hostname.toLowerCase();
    if (publicHostname && publicHostname !== "localhost") return publicHostname;
  } catch {
    // O boot/login não deve quebrar por uma URL opcional inválida.
  }
  return "apticket.aptechinfo.com.br";
}

function getTransporter(): Transporter {
  if (_transporter) return _transporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? "465");
  const secure = (process.env.SMTP_SECURE ?? "true") === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  if (!host || !user || !pass) {
    throw new Error(
      "Missing SMTP environment variable(s): SMTP_HOST, SMTP_USER, SMTP_PASSWORD. Configure SMTP to send portal verification codes.",
    );
  }

  _transporter = nodemailer.createTransport({
    name: getSmtpClientName(),
    host,
    port,
    secure, // true = implicit TLS (port 465), false = STARTTLS (port 587)
    auth: { user, pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
  });
  return _transporter;
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SentMessageInfo> {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const transporter = getTransporter();
  return transporter.sendMail({
    from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
}
