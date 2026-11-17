import { ServiceUnavailableException } from '@nestjs/common';
import * as outboundNetwork from '@apticket/outbound-network';
import { WhatsappWebhookService } from './whatsapp-webhook.service';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { RedisService } from '../../queue/redis.service';
import type { FileUploadService } from '../../files/file-upload.service';

jest.mock('@apticket/outbound-network', () => ({
  ...jest.requireActual<typeof import('@apticket/outbound-network')>(
    '@apticket/outbound-network',
  ),
  publicHttpRequest: jest.fn(),
}));

type Row = Record<string, unknown>;

// Real ingestion code; only PostgREST and Redis I/O are replaced by stores.
function fixture(
  options: {
    pending?: boolean;
    failTable?: string;
    lookupFailure?: boolean;
  } = {},
) {
  const rows: Record<string, Row[]> = {
    contacts: [
      {
        id: 'contact-a',
        tenant_id: 'tenant-a',
        company_id: options.pending ? null : 'company-a',
        name: 'Fixture',
        phone: '5511999998888',
        secondary_phones: [],
        is_active: true,
        can_open_tickets: true,
      },
    ],
    contracts: [],
    tickets: [
      {
        id: 'ticket-a',
        tenant_id: 'tenant-a',
        contact_id: 'contact-a',
        channel: 'whatsapp',
        status: 'new',
      },
    ],
    messages: [],
    whatsapp_pending_messages: [],
  };
  let failTable = options.failTable;
  let lookupFailure = options.lookupFailure;
  const uploadedPaths = new Set<string>();
  const failure = { message: 'synthetic persistence unavailable' };
  const client = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let inserted: Row | undefined;
      let maximum = Infinity;
      const execute = () => {
        if (!inserted && table === 'messages' && lookupFailure) {
          lookupFailure = false;
          return { data: null, error: failure };
        }
        if (inserted) {
          if (failTable === table) {
            failTable = undefined;
            return { data: null, error: failure };
          }
          const row = { id: `${table}-${rows[table].length + 1}`, ...inserted };
          rows[table].push(row);
          return { data: [row], error: null };
        }
        return {
          data: (rows[table] ?? [])
            .filter((row) =>
              filters.every(([key, value]) => row[key] === value),
            )
            .slice(0, maximum),
          error: null,
        };
      };
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          filters.push([key, value]);
          return query;
        },
        not: () => query,
        order: () => query,
        limit: (count: number) => {
          maximum = count;
          return query;
        },
        insert: (row: Row) => {
          inserted = row;
          return query;
        },
        maybeSingle: () => {
          const result = execute();
          if (result.data && result.data.length > 1)
            return Promise.resolve({
              data: null,
              error: { message: 'multiple rows', code: 'PGRST116' },
            });
          return Promise.resolve({ ...result, data: result.data?.[0] ?? null });
        },
        single: () => query.maybeSingle(),
        then: (resolve: (value: ReturnType<typeof execute>) => unknown) =>
          Promise.resolve(execute()).then(resolve),
      };
      return query;
    },
  };
  const reservations = new Map<string, string>();
  let cleanupFailure = false;
  const redis = {
    setIfNotExists(this: void, key: string, _ttl: number, owner = '1') {
      if (reservations.has(key)) return Promise.resolve(false);
      reservations.set(key, owner);
      return Promise.resolve(true);
    },
    deleteIfValue(key: string, owner: string) {
      if (cleanupFailure)
        return Promise.reject(new Error('synthetic redis unavailable'));
      if (reservations.get(key) !== owner) return Promise.resolve(false);
      reservations.delete(key);
      return Promise.resolve(true);
    },
  };
  const service = new WhatsappWebhookService(
    { client } as unknown as SupabaseService,
    redis as unknown as RedisService,
    {
      upload: (_bucket: string, path: string) => {
        if (uploadedPaths.has(path))
          throw new ServiceUnavailableException('object_already_exists');
        uploadedPaths.add(path);
        return Promise.resolve({ path });
      },
    } as unknown as FileUploadService,
  );
  const payload = {
    key: { id: 'external-a', remoteJid: '5511999998888@s.whatsapp.net' },
    message: { conversation: 'Mensagem de teste' },
  };
  return {
    service,
    payload,
    rows,
    uploadedPaths,
    reservations,
    redis,
    key: 'whatsapp:dedup:tenant-a:external-a',
    failCleanup: () => {
      cleanupFailure = true;
    },
  };
}

describe('WhatsApp inbound retry and deduplication', () => {
  afterEach(() => jest.resetAllMocks());

  it.each(['messages', 'whatsapp_pending_messages'])(
    'retries media after %s insert failure without reusing an orphan object',
    async (table) => {
      jest.mocked(outboundNetwork.publicHttpRequest).mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/png' }),
        bytes: Buffer.from('synthetic image'),
        text: () => '',
      });
      const f = fixture({
        pending: table === 'whatsapp_pending_messages',
        failTable: table,
      });
      const payload = {
        ...f.payload,
        message: {
          type: 'media',
          mediaType: 'image',
          filename: 'photo.png',
          content: {
            URL: 'https://media.example.test/photo.png',
            mimetype: 'image/png',
          },
        },
      };
      await expect(f.service.handle('tenant-a', payload)).rejects.toThrow();
      expect(f.uploadedPaths.size).toBe(1);
      await expect(
        f.service.handle('tenant-a', payload),
      ).resolves.toMatchObject({
        kind: table === 'messages' ? 'ticket' : 'pending',
      });
      expect(f.rows[table]).toHaveLength(1);
      expect(f.uploadedPaths.size).toBe(2);
    },
  );

  it.each(['messages', 'whatsapp_pending_messages'])(
    'recognizes historical duplicate rows in %s as persisted',
    async (table) => {
      const f = fixture();
      f.rows[table].push(
        {
          id: 'first',
          tenant_id: 'tenant-a',
          external_id: 'external-a',
          ticket_id: 'ticket-a',
        },
        {
          id: 'second',
          tenant_id: 'tenant-a',
          external_id: 'external-a',
          ticket_id: 'ticket-a',
        },
      );
      await expect(
        f.service.handle('tenant-a', f.payload),
      ).resolves.toMatchObject({ kind: 'duplicate' });
      expect(f.rows[table]).toHaveLength(2);
    },
  );
  it('retries after a message insert failure instead of acknowledging a duplicate', async () => {
    const f = fixture({ failTable: 'messages' });
    await expect(f.service.handle('tenant-a', f.payload)).rejects.toThrow(
      'insert_message_failed',
    );
    expect(f.reservations.size).toBe(0);
    await expect(f.service.handle('tenant-a', f.payload)).resolves.toEqual({
      kind: 'ticket',
      ticketId: 'ticket-a',
    });
    expect(f.rows.messages).toHaveLength(1);
  });

  it('does not acknowledge an unpersisted pending message and permits retry', async () => {
    const f = fixture({
      pending: true,
      failTable: 'whatsapp_pending_messages',
    });
    await expect(f.service.handle('tenant-a', f.payload)).rejects.toThrow(
      'insert_pending_failed',
    );
    expect(f.reservations.size).toBe(0);
    await expect(
      f.service.handle('tenant-a', f.payload),
    ).resolves.toMatchObject({ kind: 'pending' });
    expect(f.rows.whatsapp_pending_messages).toHaveLength(1);
  });

  it('does not ingest when the durable duplicate lookup is unavailable', async () => {
    const f = fixture({ lookupFailure: true });
    await expect(f.service.handle('tenant-a', f.payload)).rejects.toThrow(
      'dedup_lookup_failed',
    );
    expect(f.rows.messages).toHaveLength(0);
    await f.service.handle('tenant-a', f.payload);
    expect(f.rows.messages).toHaveLength(1);
  });

  it('keeps successful messages deduplicated even if the Redis reservation expires', async () => {
    const f = fixture();
    await f.service.handle('tenant-a', f.payload);
    f.reservations.clear();
    await expect(f.service.handle('tenant-a', f.payload)).resolves.toEqual({
      kind: 'duplicate',
      ticketId: 'ticket-a',
    });
    expect(f.rows.messages).toHaveLength(1);
  });

  it('deduplicates a durable pending message', async () => {
    const f = fixture({ pending: true });
    await f.service.handle('tenant-a', f.payload);
    f.reservations.clear();
    await expect(
      f.service.handle('tenant-a', f.payload),
    ).resolves.toMatchObject({
      kind: 'duplicate',
      pendingId: expect.any(String) as string,
    });
    expect(f.rows.whatsapp_pending_messages).toHaveLength(1);
  });

  it('retries an in-flight delivery without deleting another processing reservation', async () => {
    const f = fixture();
    f.reservations.set(f.key, 'another-owner');
    await expect(
      f.service.handle('tenant-a', f.payload),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(f.reservations.get(f.key)).toBe('another-owner');
    expect(f.rows.messages).toHaveLength(0);
  });

  it('does not release a reservation replaced by another processing attempt', async () => {
    const f = fixture({ failTable: 'messages' });
    const reserve = f.redis.setIfNotExists;
    f.redis.setIfNotExists = async (key, ttl, owner) => {
      const result = await reserve(key, ttl, owner);
      f.reservations.set(key, 'replacement-owner');
      return result;
    };
    await expect(f.service.handle('tenant-a', f.payload)).rejects.toThrow(
      'insert_message_failed',
    );
    expect(f.reservations.get(f.key)).toBe('replacement-owner');
  });

  it('preserves the persistence error if reservation cleanup also fails', async () => {
    const f = fixture({ failTable: 'messages' });
    f.failCleanup();
    await expect(f.service.handle('tenant-a', f.payload)).rejects.toThrow(
      'insert_message_failed',
    );
  });
});
