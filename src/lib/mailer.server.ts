// Server-only. Sends transactional email for the customer portal (OTP codes).
// Separate from GoTrue's own mailer — this is used for portal_otp_codes delivery,
// which is app-level (contacts are not Supabase Auth users).
import nodemailer, { type Transporter } from "nodemailer";

let _transporter: Transporter | undefined;

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
    host,
    port,
    secure, // true = implicit TLS (port 465), false = STARTTLS (port 587)
    auth: { user, pass },
  });
  return _transporter;
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const transporter = getTransporter();
  await transporter.sendMail({
    from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
}
