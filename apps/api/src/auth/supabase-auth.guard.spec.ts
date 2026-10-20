import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import jwt from 'jsonwebtoken';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import type { SupabaseService } from '../supabase/supabase.service';
import type { Env } from '../config/env.validation';

const secret = 'guard-fixture-signing-secret-for-local-tests';
const token = (version?: number) =>
  jwt.sign(
    {
      app: 'apticket',
      role: 'authenticated',
      aud: 'authenticated',
      email: 'guard@example.test',
      tenant_id: 'tenant-a',
      ...(version === undefined ? {} : { session_version: version }),
    },
    secret,
    { subject: 'fixture-user', expiresIn: '5m' },
  );

function fixture(
  version: number,
  tokenVersion?: number,
  error: object | null = null,
) {
  const profile = {
    tenant_id: 'tenant-a',
    name: 'Fixture',
    is_active: true,
    session_version: version,
  };
  const query = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest
      .fn()
      .mockResolvedValue({ data: error ? null : profile, error }),
    then: (resolve: (value: object) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve),
  };
  const client = {
    from: jest.fn(() => query),
    rpc: jest.fn().mockResolvedValue({ data: [], error: null }),
  };
  const guard = new SupabaseAuthGuard(
    { client } as unknown as SupabaseService,
    { getAllAndOverride: () => undefined } as unknown as Reflector,
    { get: () => secret } as unknown as ConfigService<Env, true>,
  );
  const request = {
    headers: { authorization: `Bearer ${token(tokenVersion)}` },
  };
  const context = {
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { guard, context, client, profile };
}

describe('API session revocation', () => {
  it('accepts a legacy JWT only while the profile is at version zero', async () => {
    const current = fixture(0);
    await expect(current.guard.canActivate(current.context)).resolves.toBe(
      true,
    );
    const revoked = fixture(1);
    await expect(
      revoked.guard.canActivate(revoked.context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(revoked.client.rpc).not.toHaveBeenCalled();
  });
  it('accepts a fresh JWT after password reset', async () => {
    const current = fixture(1, 1);
    await expect(current.guard.canActivate(current.context)).resolves.toBe(
      true,
    );
  });
  it.each(['inactive', 'tenant', 'database'])(
    'fails closed for %s',
    async (reason) => {
      const current = fixture(
        1,
        1,
        reason === 'database'
          ? { message: 'fixture database unavailable' }
          : null,
      );
      if (reason === 'inactive') current.profile.is_active = false;
      if (reason === 'tenant') current.profile.tenant_id = 'tenant-b';
      await expect(
        current.guard.canActivate(current.context),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(current.client.rpc).not.toHaveBeenCalled();
    },
  );
});
