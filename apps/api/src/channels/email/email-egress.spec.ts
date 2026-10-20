import { ImapFlow } from 'imapflow';
import { publicMailEndpoint } from '@apticket/outbound-network';
import { EmailAccountService } from './email-account.service';
import { EmailPollingService } from './email-polling.service';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { SecretsService } from '../../crypto/secrets.service';
import type { EmailSchedulerService } from './email-scheduler.service';
import type { EmailChannelService } from './email-channel.service';

jest.mock('imapflow', () => ({ ImapFlow: jest.fn() }));
jest.mock('@apticket/outbound-network', () => ({
  publicMailEndpoint: jest.fn(),
}));

describe('IMAP outbound boundary', () => {
  const endpoint = publicMailEndpoint as jest.Mock;
  const constructor = ImapFlow as unknown as jest.Mock;
  const mailbox = {
    id: 'tenant',
    email_imap_host: 'imap.example.test',
    email_imap_port: 993,
    email_imap_secure: true,
    email_imap_user: 'fixture@example.test',
    email_imap_password: 'fixture-only',
  };
  const accounts = new EmailAccountService(
    {} as SupabaseService,
    {} as SecretsService,
    {} as EmailSchedulerService,
  );
  const polling = new EmailPollingService(
    {} as SupabaseService,
    {} as SecretsService,
    {} as EmailChannelService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    endpoint.mockResolvedValue({
      host: '8.8.8.8',
      port: 993,
      servername: 'imap.example.test',
    });
    constructor.mockReturnValue({
      connect: jest.fn().mockResolvedValue(undefined),
      getMailboxLock: jest.fn().mockResolvedValue({ release: jest.fn() }),
      status: jest.fn().mockResolvedValue({}),
      logout: jest.fn().mockResolvedValue(undefined),
      search: jest.fn().mockResolvedValue([]),
    });
  });
  it('uses the validated IP and original SNI in unsaved-configuration tests', async () => {
    const result = await accounts.testConnection('tenant', {
      imapHost: mailbox.email_imap_host,
      imapPort: 993,
      imapSecure: true,
      imapUser: mailbox.email_imap_user,
      imapPassword: mailbox.email_imap_password,
    });
    expect(result.imapOk).toBe(true);
    expect(endpoint).toHaveBeenCalledWith('imap.example.test', 993);
    expect(constructor).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '8.8.8.8',
        port: 993,
        servername: 'imap.example.test',
        secure: true,
      }),
    );
  });
  it('uses the same guarded endpoint in the polling worker', async () => {
    await polling.pollTenantMailbox(mailbox);
    expect(endpoint).toHaveBeenCalledWith('imap.example.test', 993);
    expect(constructor).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '8.8.8.8',
        servername: 'imap.example.test',
      }),
    );
  });
  it('refuses blocked connection tests before constructing a client', async () => {
    endpoint.mockRejectedValue(new Error('outbound_destination_blocked'));
    const result = await accounts.testConnection('tenant', {
      imapHost: '127.0.0.1',
      imapUser: 'fixture',
      imapPassword: 'fixture-only',
    });
    expect(result.imapOk).toBe(false);
    expect(constructor).not.toHaveBeenCalled();
  });
  it('refuses blocked poll jobs before constructing a client', async () => {
    endpoint.mockRejectedValue(new Error('outbound_destination_blocked'));
    const result = await polling.pollTenantMailbox(mailbox);
    expect(result.errors).toHaveLength(1);
    expect(result.processed).toBe(0);
    expect(constructor).not.toHaveBeenCalled();
  });
});
