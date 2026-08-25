import nodemailer from 'nodemailer';
import { EmailSenderService } from './email-sender.service';

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn() },
}));

describe('EmailSenderService', () => {
  const sendMail = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    sendMail.mockResolvedValue({ messageId: '<outbound@example.com>' });
  });

  it('envia HTML, texto, threading e anexos pelo SMTP do tenant', async () => {
    const service = new EmailSenderService();
    const attachment = {
      filename: 'relatorio.pdf',
      content: Buffer.from('pdf'),
      contentType: 'application/pdf',
    };

    const result = await service.sendTenantEmail(
      {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        user: 'suporte@example.com',
        password: 'secret',
        fromName: 'Suporte',
      },
      {
        to: 'cliente@example.com',
        subject: 'Re: Ticket #42',
        text: 'Resposta formatada',
        html: '<p><strong>Resposta</strong> formatada</p>',
        inReplyTo: '<inbound@example.com>',
        references: '<inbound@example.com>',
        attachments: [attachment],
      },
    );

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'suporte@example.com', pass: 'secret' },
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Suporte <suporte@example.com>',
        to: 'cliente@example.com',
        html: '<p><strong>Resposta</strong> formatada</p>',
        inReplyTo: '<inbound@example.com>',
        references: '<inbound@example.com>',
        attachments: [attachment],
      }),
    );
    expect(result).toEqual({ messageId: '<outbound@example.com>' });
  });
});
