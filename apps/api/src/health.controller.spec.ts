import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppController } from './app.controller';
import { RedisService } from './queue/redis.service';
import { SupabaseService } from './supabase/supabase.service';
import { SupabaseAuthGuard } from './auth/supabase-auth.guard';
import type { Env } from './config/env.validation';
import { ReadinessService } from './health/readiness.service';

describe('API liveness and readiness HTTP', () => {
  let app: INestApplication;
  const query = {
    select: jest.fn(),
    limit: jest.fn(),
    abortSignal: jest.fn<Promise<{ error: unknown }>, [AbortSignal]>(),
  };
  const probe = {
    connect: jest.fn(),
    ping: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn(),
  };
  const redis = { client: { status: 'ready', duplicate: jest.fn() } };
  const supabase = { client: { from: jest.fn() } };
  beforeEach(async () => {
    query.select.mockReset().mockReturnValue(query);
    query.limit.mockReset().mockReturnValue(query);
    query.abortSignal.mockReset().mockResolvedValue({ error: null });
    probe.connect.mockReset().mockResolvedValue(undefined);
    probe.ping.mockReset().mockResolvedValue('PONG');
    probe.disconnect.mockReset();
    probe.on.mockReset().mockReturnValue(probe);
    redis.client.status = 'ready';
    redis.client.duplicate.mockReset().mockReturnValue(probe);
    supabase.client.from.mockReset().mockReturnValue(query);
    const module = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        ReadinessService,
        { provide: RedisService, useValue: redis },
        { provide: SupabaseService, useValue: supabase },
      ],
    }).compile();
    app = module.createNestApplication();
    const config = {
      get: () => 'synthetic-jwt-key',
    } as unknown as ConfigService<Env, true>;
    app.useGlobalGuards(
      new SupabaseAuthGuard(
        supabase as unknown as SupabaseService,
        new Reflector(),
        config,
      ),
    );
    await app.listen(0, '127.0.0.1');
  });
  afterEach(async () => {
    await app.close();
  });
  const get = (path: string) =>
    request(app.getHttpServer() as Server).get(path);

  it('returns 503 for unavailable dependencies without authenticating or leaking details', async () => {
    redis.client.status = 'end';
    query.abortSignal.mockResolvedValue({
      error: { message: 'private-password-and-host' },
    });
    const response = await get('/health/ready')
      .expect(503)
      .expect('Cache-Control', 'no-store');
    expect(response.body).toEqual({
      ok: false,
      checks: { database: 'down', redis: 'down' },
    });
    expect(JSON.stringify(response.body)).not.toContain('private-password');
    expect(redis.client.duplicate).not.toHaveBeenCalled();
  });
  it('retains the lightweight liveness endpoint during dependency failure', async () => {
    redis.client.status = 'end';
    query.abortSignal.mockRejectedValue(new Error('unavailable'));
    await get('/health').expect(200).expect({ ok: true });
    expect(supabase.client.from).not.toHaveBeenCalled();
    expect(redis.client.duplicate).not.toHaveBeenCalled();
  });
  it('checks PostgREST without returning rows and disposes its isolated Redis probe', async () => {
    await get('/health/ready')
      .expect(200)
      .expect({ ok: true, checks: { database: 'up', redis: 'up' } });
    expect(supabase.client.from).toHaveBeenCalledWith('tenants');
    expect(query.select).toHaveBeenCalledWith('id', { head: true });
    expect(query.limit).toHaveBeenCalledWith(0);
    expect(query.abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
    expect(probe.disconnect).toHaveBeenCalled();
    expect(redis.client.duplicate).toHaveBeenCalledWith(
      expect.objectContaining({
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
      }),
    );
  });
  it('bounds hanging SDKs and cancels their resources', async () => {
    query.abortSignal.mockImplementation(() => new Promise(() => {}));
    probe.connect.mockImplementation(() => new Promise(() => {}));
    const start = Date.now();
    await get('/health/ready').expect(503);
    expect(Date.now() - start).toBeLessThan(3500);
    expect(query.abortSignal.mock.calls[0][0].aborted).toBe(true);
    expect(probe.disconnect).toHaveBeenCalled();
  });
  it('coalesces concurrent checks and limits cached failures to one second', async () => {
    let release: (value: { error: null }) => void = () => {};
    query.abortSignal.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const checks = Array.from({ length: 8 }, () =>
      get('/health/ready').then((response) => response.status),
    );
    for (
      let attempt = 0;
      attempt < 100 && !query.abortSignal.mock.calls.length;
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    release({ error: null });
    expect(await Promise.all(checks)).toEqual(Array(8).fill(200));
    expect(query.abortSignal).toHaveBeenCalledTimes(1);
    query.abortSignal.mockResolvedValue({ error: { message: 'unavailable' } });
    await get('/health/ready').expect(200);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await get('/health/ready').expect(503);
    query.abortSignal.mockResolvedValue({ error: null });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await get('/health/ready').expect(200);
    expect(query.abortSignal).toHaveBeenCalledTimes(3);
  });
});
