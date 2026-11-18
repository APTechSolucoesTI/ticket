import { BadRequestException } from '@nestjs/common';
import { EmailReplyService } from './email-reply.service';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { SecretsService } from '../../crypto/secrets.service';
import type { EmailSenderService } from './email-sender.service';

describe('EmailReplyService contact channels', () => {
  function fixture(contact: {
    email: string | null;
    secondary_emails?: string[] | null;
  }) {
    const events: string[] = [];
    const ticketQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: {
          id: 'ticket-a',
          tenant_id: 'tenant-a',
          subject: 'Support request',
          channel: 'email',
          contact_id: 'contact-a',
          contacts: { ...contact, name: 'Contact' },
        },
        error: null,
      }),
    };
    const tenantQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: {
          name: 'Tenant A',
          email_imap_user: 'support@example.test',
          email_imap_password: 'encrypted-fixture',
          email_smtp_host: 'smtp.example.test',
          email_smtp_port: 465,
          email_smtp_secure: true,
        },
        error: null,
      }),
    };
    const messageUpdateQuery = {
      eq: jest.fn().mockResolvedValue({ error: null }),
    };
    const messageQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { external_id: '<inbound@example.test>' },
        error: null,
      }),
      insert: jest.fn().mockImplementation(() => {
        events.push('insert');
        return messageQuery;
      }),
      single: jest.fn().mockResolvedValue({
        data: { id: 'message-a' },
        error: null,
      }),
      update: jest.fn().mockImplementation(() => {
        events.push('update');
        return messageUpdateQuery;
      }),
    };
    const from = jest.fn((table: string) => {
      if (table === 'tickets') return ticketQuery;
      if (table === 'tenants') return tenantQuery;
      if (table === 'messages') return messageQuery;
      throw new Error(`Unexpected table ${table}`);
    });
    const decrypt = jest.fn().mockReturnValue('synthetic-secret');
    const sendTenantEmail = jest.fn().mockImplementation(() => {
      events.push('send');
      return Promise.resolve({ messageId: '<outbound@example.test>' });
    });
    const service = new EmailReplyService(
      { client: { from } } as unknown as SupabaseService,
      { decrypt } as unknown as SecretsService,
      { sendTenantEmail } as unknown as EmailSenderService,
    );
    return {
      service,
      ticketQuery,
      tenantQuery,
      messageQuery,
      messageUpdateQuery,
      from,
      decrypt,
      sendTenantEmail,
      events,
    };
  }

  it('prefers the primary email when secondary emails also exist', async () => {
    const f = fixture({
      email: 'primary@example.test',
      secondary_emails: ['secondary@example.test'],
    });
    await f.service.reply('tenant-a', 'agent-a', 'ticket-a', '<p>Reply</p>');
    expect(f.sendTenantEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ to: 'primary@example.test' }),
    );
  });

  it.each([null, '', '   '])(
    'uses the first nonempty secondary email when primary email is %p',
    async (email) => {
      const f = fixture({
        email,
        secondary_emails: [
          '',
          '   ',
          'first@example.test',
          'next@example.test',
        ],
      });
      await expect(
        f.service.reply('tenant-a', 'agent-a', 'ticket-a', '<p>Reply</p>'),
      ).resolves.toEqual({ ok: true, messageId: 'message-a' });
      expect(f.ticketQuery.select).toHaveBeenCalledWith(
        expect.stringContaining('contacts(email, secondary_emails, name)'),
      );
      expect(f.sendTenantEmail).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ to: 'first@example.test' }),
      );
    },
  );

  it('keeps tenant scoping, SMTP configuration, author and delivery recording for secondary recipients', async () => {
    const f = fixture({
      email: null,
      secondary_emails: ['secondary@example.test'],
    });
    await f.service.reply('tenant-a', 'agent-a', 'ticket-a', '<p>Reply</p>');
    expect(f.ticketQuery.eq.mock.calls).toEqual([
      ['id', 'ticket-a'],
      ['tenant_id', 'tenant-a'],
    ]);
    expect(f.tenantQuery.eq).toHaveBeenCalledWith('id', 'tenant-a');
    expect(f.decrypt).toHaveBeenCalledWith('encrypted-fixture');
    expect(f.sendTenantEmail).toHaveBeenCalledWith(
      {
        host: 'smtp.example.test',
        port: 465,
        secure: true,
        user: 'support@example.test',
        password: 'synthetic-secret',
        fromName: 'Tenant A',
      },
      {
        to: 'secondary@example.test',
        subject: 'Re: Support request',
        text: 'Reply',
        html: '<p>Reply</p>',
        inReplyTo: '<inbound@example.test>',
        references: '<inbound@example.test>',
        attachments: [],
      },
    );
    expect(f.messageQuery.insert).toHaveBeenCalledWith({
      tenant_id: 'tenant-a',
      ticket_id: 'ticket-a',
      author_id: 'agent-a',
      author_type: 'agent',
      channel: 'email',
      is_internal: false,
      content: '<p>Reply</p>',
      attachments: [],
      delivery_status: 'sending',
      delivery_attempts: 1,
    });
    expect(f.messageQuery.update).toHaveBeenCalledWith({
      external_id: '<outbound@example.test>',
      delivery_status: 'sent',
      delivery_error: null,
    });
    expect(f.messageUpdateQuery.eq).toHaveBeenCalledWith('id', 'message-a');
    expect(f.events).toEqual(['insert', 'send', 'update']);
  });

  it.each([undefined, null, [], ['', '   ']])(
    'rejects contacts without an email when secondary emails are %p',
    async (secondary_emails) => {
      const f = fixture({ email: null, secondary_emails });
      await expect(
        f.service.reply('tenant-a', 'agent-a', 'ticket-a', '<p>Reply</p>'),
      ).rejects.toThrow(BadRequestException);
      expect(f.from.mock.calls).toEqual([['tickets']]);
      expect(f.messageQuery.insert).not.toHaveBeenCalled();
      expect(f.sendTenantEmail).not.toHaveBeenCalled();
    },
  );
});
