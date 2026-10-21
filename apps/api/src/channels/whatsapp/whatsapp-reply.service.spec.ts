import { WhatsappReplyService } from './whatsapp-reply.service';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { SecretsService } from '../../crypto/secrets.service';
import type { RedisService } from '../../queue/redis.service';
import type { UazapiService } from './uazapi.service';

describe('WhatsApp attachment capability boundary', () => {
  function fixture(
    insertError: Error | null = null,
    signingError: Error | null = null,
  ) {
    const events: string[] = [];
    const createSignedUrl = jest.fn(() => {
      events.push('sign');
      return Promise.resolve({
        data: signingError
          ? null
          : { signedUrl: 'https://storage.example.test/authorized' },
        error: signingError,
      });
    });
    const update = jest.fn().mockReturnValue({
      eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
    });
    const client = {
      from: jest.fn((table: string) => {
        const query = {
          select: jest.fn(),
          eq: jest.fn(),
          maybeSingle: () =>
            Promise.resolve({
              data:
                table === 'tickets'
                  ? {
                      id: 'ticket-a',
                      channel: 'whatsapp',
                      contacts: { phone: '5511999999999' },
                    }
                  : {
                      whatsapp_enabled: true,
                      whatsapp_uazapi_base_url: 'https://provider.example.test',
                      whatsapp_uazapi_token: 'encrypted-fixture',
                    },
              error: null,
            }),
          insert: jest.fn(),
          single: () => {
            events.push('bind');
            return Promise.resolve({
              data: { id: 'message' },
              error: insertError,
            });
          },
          update,
        };
        query.select.mockReturnValue(query);
        query.eq.mockReturnValue(query);
        query.insert.mockReturnValue(query);
        return query;
      }),
      storage: { from: () => ({ createSignedUrl }) },
    };
    const sendMedia = jest.fn(() => {
      events.push('send');
      return Promise.resolve({ ok: true, body: { id: 'external' } });
    });
    const service = new WhatsappReplyService(
      { client } as unknown as SupabaseService,
      { decrypt: () => 'synthetic-secret' } as unknown as SecretsService,
      {
        checkRateLimit: () => Promise.resolve({ allowed: true }),
      } as unknown as RedisService,
      { sendMedia } as unknown as UazapiService,
    );
    const media = {
      ticketId: 'ticket-a',
      path: 'tenant-a/ticket-a/file.pdf',
      url: 'https://attacker.example.test/foreign-file',
      filename: 'file.pdf',
      mimetype: 'application/pdf',
      size: 4,
    };
    return { service, media, events, createSignedUrl, sendMedia, update };
  }

  it('binds first and forwards only a server-generated URL for the validated path', async () => {
    const f = fixture();
    await expect(
      f.service.replyMedia('tenant-a', 'agent', f.media),
    ).resolves.toEqual({
      ok: true,
      messageId: 'message',
      externalId: 'external',
    });
    expect(f.events).toEqual(['bind', 'sign', 'send']);
    expect(f.createSignedUrl).toHaveBeenCalledWith(f.media.path, 120);
    expect(f.sendMedia.mock.calls[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: 'https://storage.example.test/authorized',
        }),
      ]),
    );
    expect(JSON.stringify(f.sendMedia.mock.calls)).not.toContain(
      'attacker.example.test',
    );
  });

  it('stops private or foreign bindings before signing or sending', async () => {
    const f = fixture(new Error('Private attachments cannot be published'));
    await expect(
      f.service.replyMedia('tenant-a', 'agent', f.media),
    ).rejects.toThrow('Private attachments');
    expect(f.events).toEqual(['bind']);
    expect(f.createSignedUrl).not.toHaveBeenCalled();
    expect(f.sendMedia).not.toHaveBeenCalled();
  });

  it.each([
    'tenant-a/ticket-b/file.pdf',
    'tenant-b/ticket-a/file.pdf',
    'tenant-a/ticket-a/../file.pdf',
    'tenant-a/ticket-a/%2e%2e/file.pdf',
  ])('rejects noncanonical or foreign key %s', async (path) => {
    const f = fixture();
    await expect(
      f.service.replyMedia('tenant-a', 'agent', { ...f.media, path }),
    ).rejects.toThrow('Caminho de anexo');
    expect(f.events).toEqual([]);
  });

  it('does not send when the signer fails and records the failed delivery', async () => {
    const f = fixture(null, new Error('signer unavailable'));
    await expect(
      f.service.replyMedia('tenant-a', 'agent', f.media),
    ).rejects.toThrow('carregar o anexo');
    expect(f.events).toEqual(['bind', 'sign']);
    expect(f.update).toHaveBeenCalledWith(
      expect.objectContaining({ delivery_status: 'failed' }),
    );
  });

  it('also binds gallery stickers before signing and ignores their supplied URL', async () => {
    const f = fixture();
    await f.service.replySticker('tenant-a', 'agent', {
      ...f.media,
      path: 'tenant-a/_stickers/file.webp',
    });
    expect(f.events).toEqual(['bind', 'sign', 'send']);
    expect(f.createSignedUrl).toHaveBeenCalledWith(
      'tenant-a/_stickers/file.webp',
      120,
    );
    expect(JSON.stringify(f.sendMedia.mock.calls)).not.toContain(
      'attacker.example.test',
    );
  });
});
