import { Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';

// Portado de apps/web/src/lib/email-send.server.ts, sem mudança de lógica.
export type TenantSmtp = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromName?: string | null;
};

@Injectable()
export class EmailSenderService {
  async sendTenantEmail(
    smtp: TenantSmtp,
    opts: {
      to: string;
      subject: string;
      text: string;
      html?: string;
      inReplyTo?: string | null;
      references?: string | null;
      attachments?: Array<{
        filename: string;
        content: Buffer;
        contentType: string;
      }>;
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
      html: opts.html,
      inReplyTo: opts.inReplyTo ?? undefined,
      references: opts.references ?? undefined,
      attachments: opts.attachments,
    });

    return { messageId: info.messageId ?? null };
  }
}
