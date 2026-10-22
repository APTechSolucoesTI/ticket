import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Server } from 'node:http';
import {
  FilesController,
  InternalFileUploadGuard,
  UploadCapacityGuard,
} from './files.controller';
import { FileUploadService } from './file-upload.service';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseService } from '../supabase/supabase.service';

describe('file upload HTTP authentication and bounded multipart parser', () => {
  let app: INestApplication;
  const secret = 'upload-fixture-jwt-signing-key';
  const internalKey = 'upload-fixture-private-server-key';
  const tenant = 'af100000-0000-4000-8000-000000000001';
  const path = `${tenant}/af200000-0000-4000-8000-000000000001/fixture.pdf`;
  const profile = {
    tenant_id: tenant,
    name: 'Fixture',
    is_active: true,
    session_version: 0,
  };
  const authorize = jest.fn().mockResolvedValue(undefined);
  const upload = jest.fn().mockResolvedValue({ path });
  const token = (version = 0, tenantId = tenant) =>
    jwt.sign(
      {
        app: 'apticket',
        role: 'authenticated',
        aud: 'authenticated',
        email: 'upload@example.test',
        tenant_id: tenantId,
        session_version: version,
      },
      secret,
      { subject: 'fixture-user', expiresIn: '5m' },
    );
  beforeAll(async () => {
    const query = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: () => Promise.resolve({ data: profile, error: null }),
      then: (resolve: (value: object) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    };
    const module = await Test.createTestingModule({
      controllers: [FilesController],
      providers: [
        InternalFileUploadGuard,
        UploadCapacityGuard,
        { provide: FileUploadService, useValue: { authorize, upload } },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'JWT_SECRET' ? secret : internalKey),
          },
        },
        {
          provide: SupabaseService,
          useValue: {
            client: {
              from: () => query,
              rpc: () => Promise.resolve({ data: [], error: null }),
            },
          },
        },
        { provide: APP_GUARD, useClass: SupabaseAuthGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  beforeEach(() => {
    authorize.mockClear();
    upload.mockClear();
    profile.session_version = 0;
  });
  afterAll(async () => {
    await app.close();
  });
  it('rejects anonymous and invalid JWT uploads before domain authorization', async () => {
    await request(app.getHttpServer() as Server)
      .post('/files/upload')
      .expect(401);
    await request(app.getHttpServer() as Server)
      .post('/files/upload')
      .set('Authorization', 'Bearer invalid')
      .expect(401);
    expect(authorize).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
  it('rejects revoked and foreign-tenant sessions', async () => {
    profile.session_version = 1;
    await request(app.getHttpServer() as Server)
      .post('/files/upload')
      .set('Authorization', `Bearer ${token()}`)
      .expect(401);
    profile.session_version = 0;
    await request(app.getHttpServer() as Server)
      .post('/files/upload')
      .set('Authorization', `Bearer ${token(0, 'foreign-tenant')}`)
      .expect(401);
    expect(upload).not.toHaveBeenCalled();
  });
  it('authorizes with the exact caller token before handing bytes to the scanner service', async () => {
    const bearer = `Bearer ${token()}`;
    await request(app.getHttpServer() as Server)
      .post('/files/upload')
      .set('Authorization', bearer)
      .field('bucket', 'ticket-attachments')
      .field('path', path)
      .attach('file', Buffer.from('synthetic bytes'), 'fixture.pdf')
      .expect(201);
    expect(authorize).toHaveBeenCalledWith(bearer, 'ticket-attachments', path);
    expect(upload).toHaveBeenCalledWith(
      'ticket-attachments',
      path,
      expect.any(Buffer),
      'fixture.pdf',
      'application/pdf',
    );
    expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(
      upload.mock.invocationCallOrder[0],
    );
  });
  it('stops a resource-scope denial before scanning or storage', async () => {
    authorize.mockRejectedValueOnce(new ForbiddenException());
    await request(app.getHttpServer() as Server)
      .post('/files/upload')
      .set('Authorization', `Bearer ${token()}`)
      .field('bucket', 'ticket-attachments')
      .field('path', path)
      .attach('file', Buffer.from('fixture'), 'fixture.pdf')
      .expect(403);
    expect(upload).not.toHaveBeenCalled();
  });
  it('rejects a file beyond 25 MiB in the multipart parser', async () => {
    await request(app.getHttpServer() as Server)
      .post('/files/upload')
      .set('Authorization', `Bearer ${token()}`)
      .field('bucket', 'ticket-attachments')
      .field('path', path)
      .attach('file', Buffer.alloc(25 * 1024 * 1024 + 1), 'large.pdf')
      .expect(413);
    expect(authorize).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
  it('rejects multiple files and excess fields', async () => {
    await request(app.getHttpServer() as Server)
      .post('/files/upload')
      .set('Authorization', `Bearer ${token()}`)
      .field('bucket', 'ticket-attachments')
      .field('path', path)
      .attach('file', Buffer.from('one'), 'one.pdf')
      .attach('file', Buffer.from('two'), 'two.pdf')
      .expect(400);
    expect(upload).not.toHaveBeenCalled();
  });
  it('does not accept a browser JWT or publishable key as the internal credential', async () => {
    await request(app.getHttpServer() as Server)
      .post('/files/internal-upload')
      .set('Authorization', `Bearer ${token()}`)
      .expect(403);
    await request(app.getHttpServer() as Server)
      .post('/files/internal-upload')
      .set('X-APTicket-Internal-Key', 'fixture-publishable-key')
      .expect(403);
    expect(upload).not.toHaveBeenCalled();
  });
  it('allows only the private internal credential and still goes through the same scanner service', async () => {
    await request(app.getHttpServer() as Server)
      .post('/files/internal-upload')
      .set('X-APTicket-Internal-Key', internalKey)
      .field('bucket', 'ticket-attachments')
      .field('path', path)
      .attach('file', Buffer.from('fixture'), 'fixture.pdf')
      .expect(201);
    expect(authorize).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
