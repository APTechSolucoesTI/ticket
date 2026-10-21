import { ConfigService } from '@nestjs/config';
import {
  WhatsappNotificationService,
  STATUS_TEXT,
} from './whatsapp-notification.service';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { SecretsService } from '../../crypto/secrets.service';
import type { RedisService } from '../../queue/redis.service';
import type { UazapiService } from './uazapi.service';
import type { Env } from '../../config/env.validation';

describe('credential boundary for legacy notifications', () => {
  function fixture(
    ticket: object | null = {
      id: 'ticket',
      channel: 'whatsapp',
      contacts: { phone: '5511999999999' },
    },
  ) {
    const eq = jest.fn();
    const insert = jest.fn().mockResolvedValue({ error: null });
    const client = {
      from: jest.fn((table: string) => {
        const query = {
          select: jest.fn(),
          eq,
          maybeSingle: jest.fn().mockResolvedValue({
            data:
              table === 'tickets'
                ? ticket
                : {
                    whatsapp_enabled: true,
                    whatsapp_uazapi_base_url: 'https://provider.example.test',
                    whatsapp_uazapi_token: 'fixture-ciphertext',
                  },
            error: null,
          }),
          insert,
        };
        query.select.mockReturnValue(query);
        eq.mockReturnValue(query);
        return query;
      }),
    };
    const decrypt = jest.fn().mockReturnValue('fixture-plaintext');
    const sendText = jest.fn().mockResolvedValue({ ok: true });
    const service = new WhatsappNotificationService(
      { client } as unknown as SupabaseService,
      { decrypt } as unknown as SecretsService,
      {
        checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
      } as unknown as RedisService,
      { sendText } as unknown as UazapiService,
      {} as ConfigService<Env, true>,
    );
    return { service, eq, insert, decrypt, sendText };
  }
  it('decrypts only in API and never returns the token', async () => {
    const f = fixture();
    const result = await f.service.notify('tenant-a', 'ticket', 'resolved');
    expect(f.eq).toHaveBeenCalledWith('tenant_id', 'tenant-a');
    expect(f.decrypt).toHaveBeenCalledWith('fixture-ciphertext');
    expect(f.sendText).toHaveBeenCalledWith(
      'https://provider.example.test',
      'fixture-plaintext',
      '5511999999999',
      STATUS_TEXT.resolved,
    );
    expect(result).toEqual({ skipped: false, ok: true });
    expect(JSON.stringify(result)).not.toContain('fixture-');
  });
  it('rejects another tenant ticket before reading or decrypting credentials', async () => {
    const f = fixture(null);
    await expect(
      f.service.notify('tenant-a', 'foreign-ticket', 'closed'),
    ).rejects.toThrow('Ticket não encontrado');
    expect(f.decrypt).not.toHaveBeenCalled();
    expect(f.sendText).not.toHaveBeenCalled();
  });
  it('preserves skip behavior for non-WhatsApp tickets', async () => {
    const f = fixture({ channel: 'email' });
    await expect(
      f.service.notify('tenant-a', 'ticket', 'closed'),
    ).resolves.toEqual({ skipped: true });
    expect(f.decrypt).not.toHaveBeenCalled();
  });
});
