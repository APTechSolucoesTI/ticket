import { EmailChannelService } from './email-channel.service';
import type { SupabaseService } from '../../supabase/supabase.service';

describe('EmailChannelService contact channels', () => {
  function fixture(
    primary: unknown,
    secondary: unknown,
    secondaryError: unknown = null,
  ) {
    const query = {
      select: jest.fn().mockReturnThis(),
      ilike: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      contains: jest.fn().mockReturnThis(),
      maybeSingle: jest
        .fn()
        .mockResolvedValueOnce({ data: primary, error: null })
        .mockResolvedValueOnce({ data: secondary, error: secondaryError }),
    };
    const from = jest.fn().mockReturnValue(query);
    const service = new EmailChannelService({
      client: { from },
    } as unknown as SupabaseService);
    return { service, query, from };
  }
  const contact = {
    id: 'contact',
    tenant_id: 'tenant',
    company_id: 'client',
    is_active: true,
    can_open_tickets: false,
  };
  const inbound = {
    message_id: 'message',
    from_email: ' SECONDARY@EXAMPLE.COM ',
    subject: 'Test',
    body: 'Test',
    tenant_id: 'tenant',
  };

  it('recognizes a secondary email and retains contact permissions', async () => {
    const { service, query, from } = fixture(null, contact);
    await expect(service.processInboundEmail(inbound)).resolves.toEqual({
      status: 'skipped',
      reason: 'contact_not_allowed',
    });
    expect(query.contains).toHaveBeenCalledWith('secondary_emails', [
      'secondary@example.com',
    ]);
    expect(query.eq).toHaveBeenCalledTimes(2);
    expect(query.eq).toHaveBeenCalledWith('tenant_id', 'tenant');
    expect(from).toHaveBeenCalledTimes(2);
  });

  it('does not look up secondary emails when the primary matches', async () => {
    const { service, query } = fixture(contact, null);
    await expect(service.processInboundEmail(inbound)).resolves.toEqual({
      status: 'skipped',
      reason: 'contact_not_allowed',
    });
    expect(query.contains).not.toHaveBeenCalled();
  });

  it('reports lookup errors instead of treating the secondary sender as unknown', async () => {
    const { service } = fixture(null, null, {
      message: 'Database unavailable',
    });
    await expect(service.processInboundEmail(inbound)).resolves.toEqual({
      status: 'error',
      reason: 'db_error',
    });
  });
});
