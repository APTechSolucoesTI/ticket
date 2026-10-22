import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { FileUploadService } from './file-upload.service';
import { FileSecurityService } from './file-security.service';
import { SupabaseService } from '../supabase/supabase.service';
import type { Env } from '../config/env.validation';
import { createServer } from 'node:http';

describe('scan receipt precedes every privileged Storage write', () => {
  const path = 'af100000-0000-4000-8000-000000000001/ticket/fixture.txt';
  const bytes = Buffer.from('Synthetic clean fixture');
  const permit = 'af200000-0000-4000-8000-000000000001';
  const calls: string[] = [];
  const validate = jest.fn();
  const upload = jest.fn();
  const rpc = jest.fn();
  let service: FileUploadService;
  beforeEach(() => {
    calls.length = 0;
    validate.mockReset().mockImplementation(() => {
      calls.push('scan');
      return Promise.resolve('text/plain');
    });
    rpc.mockReset().mockImplementation((name: string) => {
      calls.push(name);
      return Promise.resolve({ data: permit, error: null });
    });
    upload.mockReset().mockImplementation(() => {
      calls.push('write');
      return Promise.resolve({ data: { path }, error: null });
    });
    service = new FileUploadService(
      {
        client: { rpc, storage: { from: () => ({ upload }) } },
      } as unknown as SupabaseService,
      { validate } as unknown as FileSecurityService,
      {} as ConfigService<Env, true>,
    );
  });
  const store = () =>
    service.upload(
      'ticket-attachments',
      path,
      bytes,
      'fixture.txt',
      'text/plain',
    );
  it('mints a permit only after the scanner and binds exact bytes, path and size', async () => {
    await expect(store()).resolves.toEqual({ path });
    expect(calls).toEqual(['scan', 'create_scanned_upload_permit', 'write']);
    expect(rpc).toHaveBeenCalledWith('create_scanned_upload_permit', {
      _bucket: 'ticket-attachments',
      _path: path,
      _byte_length: bytes.length,
      _sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(upload).toHaveBeenCalledWith(path, bytes, {
      contentType: 'text/plain',
      upsert: false,
      metadata: { scan_id: permit },
    });
  });
  it.each([new BadRequestException(), new ServiceUnavailableException()])(
    'never writes or issues a permit after a scanner rejection/outage',
    async (error) => {
      validate.mockRejectedValue(error);
      await expect(store()).rejects.toBe(error);
      expect(upload).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it('fails closed on unavailable receipt storage', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'fixture outage' } });
    await expect(store()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(upload).not.toHaveBeenCalled();
  });
  it('revokes the unused receipt and preserves retry semantics on Storage failure', async () => {
    upload.mockImplementation(() => {
      calls.push('write');
      return Promise.resolve({
        data: null,
        error: { message: 'fixture outage' },
      });
    });
    await expect(store()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(calls).toEqual([
      'scan',
      'create_scanned_upload_permit',
      'write',
      'revoke_scanned_upload_permit',
    ]);
    expect(rpc).toHaveBeenLastCalledWith('revoke_scanned_upload_permit', {
      _id: permit,
    });
  });
  it('rejects traversal before scanner or privileged writes', async () => {
    await expect(
      service.upload(
        'ticket-attachments',
        path + '/../bad.txt',
        bytes,
        'fixture.txt',
        'text/plain',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(validate).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('upload authorization never inherits the private gateway identity', () => {
  it.each([true, false])(
    'forwards the caller JWT to the user-context RPC (allowed=%s)',
    async (allowed) => {
      const observed: {
        url?: string;
        authorization?: string;
        apiKey?: string;
        schema?: string;
      } = {};
      const server = createServer((request, response) => {
        observed.url = request.url;
        observed.authorization = request.headers.authorization;
        observed.apiKey = request.headers.apikey as string;
        observed.schema = request.headers['content-profile'] as string;
        request.resume();
        response
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify(allowed));
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('fixture listen failed');
      try {
        const service = new FileUploadService(
          {} as SupabaseService,
          {} as FileSecurityService,
          {
            get: (name: string) =>
              name === 'SUPABASE_URL'
                ? `http://127.0.0.1:${address.port}`
                : 'synthetic-private-gateway-key',
          } as unknown as ConfigService<Env, true>,
        );
        const result = service.authorize(
          'Bearer synthetic-user-jwt',
          'ticket-attachments',
          'synthetic-path',
        );
        if (allowed) await expect(result).resolves.toBeUndefined();
        else await expect(result).rejects.toThrow('Sem permissão');
        expect(observed).toEqual({
          url: '/rest/v1/rpc/can_upload_apticket_object',
          authorization: 'Bearer synthetic-user-jwt',
          apiKey: 'synthetic-private-gateway-key',
          schema: 'apticket',
        });
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );
});
