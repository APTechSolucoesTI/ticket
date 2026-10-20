import type { ConfigService } from '@nestjs/config';
import type { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { ChatGateway } from './chat.gateway';
import type { ChatMessageService } from './chat-message.service';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { RedisService } from '../../queue/redis.service';
import type { Env } from '../../config/env.validation';

const secret = 'chat-fixture-signing-secret-for-local-tests';
const profile = {
  id: 'fixture-user',
  tenant_id: 'tenant-a',
  name: 'Fixture',
  is_active: true,
  session_version: 1,
};
const auth = () => ({
  userId: profile.id,
  tenantId: profile.tenant_id,
  name: 'Fixture',
  sessionVersion: 1,
  expiresAt: Math.floor(Date.now() / 1000) + 300,
  permissions: new Set(['tickets:view']),
});
const socket = (id: string, changes: object = {}) => ({
  id,
  data: { auth: { ...auth(), ...changes } },
  emit: jest.fn(),
  disconnect: jest.fn(),
});

function fixture() {
  const state = { profile: { ...profile }, error: null as object | null };
  const query = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(() =>
      Promise.resolve({
        data: state.error ? null : state.profile,
        error: state.error,
      }),
    ),
    in: jest.fn(() =>
      Promise.resolve({
        data: state.error ? null : [state.profile],
        error: state.error,
      }),
    ),
  };
  const gateway = new ChatGateway(
    {
      client: {
        from: () => query,
        rpc: () =>
          Promise.resolve({
            data: [{ effective: true, module: 'tickets', action: 'view' }],
            error: null,
          }),
      },
    } as unknown as SupabaseService,
    { client: { set: jest.fn(), del: jest.fn() } } as unknown as RedisService,
    {} as ChatMessageService,
    { get: () => secret } as unknown as ConfigService<Env, true>,
  );
  return { gateway, state };
}

describe('Chat session revocation', () => {
  it('filters existing local/remote recipients before broadcasting', async () => {
    const { gateway } = fixture();
    const current = socket('current');
    const rejected = [
      socket('revoked', { sessionVersion: 0 }),
      socket('tenant', { tenantId: 'tenant-b' }),
      socket('expired', { expiresAt: 1 }),
      socket('missing', { userId: 'unknown' }),
    ];
    gateway.server = {
      in: () => ({
        fetchSockets: () => Promise.resolve([current, ...rejected]),
      }),
    } as unknown as Server;
    await gateway.notifyTicketAssigned('tenant-a', 'ticket', 'agent');
    expect(current.emit).toHaveBeenCalledWith('ticket:assigned', {
      ticketId: 'ticket',
      assigneeId: 'agent',
    });
    for (const recipient of rejected) {
      expect(recipient.emit).not.toHaveBeenCalled();
      expect(recipient.disconnect).toHaveBeenCalledWith(true);
    }
  });
  it.each(['inactive', 'database'])(
    'does not broadcast when %s',
    async (reason) => {
      const { gateway, state } = fixture();
      if (reason === 'inactive') state.profile.is_active = false;
      else state.error = { message: 'fixture unavailable' };
      const recipient = socket('current');
      gateway.server = {
        in: () => ({ fetchSockets: () => Promise.resolve([recipient]) }),
      } as unknown as Server;
      await gateway.notifyTicketAssigned('tenant-a', 'ticket', null);
      expect(recipient.emit).not.toHaveBeenCalled();
    },
  );
  it('rechecks every incoming packet after a successful handshake', async () => {
    const { gateway, state } = fixture();
    let middleware!: (client: Socket, next: (error?: Error) => void) => void;
    gateway.afterInit({
      use: (callback: typeof middleware) => {
        middleware = callback;
      },
    } as unknown as Server);
    let packet!: (payload: unknown, next: (error?: Error) => void) => void;
    const client = {
      data: {},
      handshake: {
        auth: {
          token: jwt.sign(
            {
              app: 'apticket',
              role: 'authenticated',
              aud: 'authenticated',
              email: 'chat@example.test',
              tenant_id: profile.tenant_id,
              session_version: 1,
            },
            secret,
            { subject: profile.id, expiresIn: '5m' },
          ),
        },
      },
      use: (callback: typeof packet) => {
        packet = callback;
      },
      disconnect: jest.fn(),
    };
    const handshake = await new Promise<Error | undefined>((resolve) =>
      middleware(client as unknown as Socket, resolve),
    );
    expect(handshake).toBeUndefined();
    expect(
      await new Promise((resolve) => packet(['ticket:join'], resolve)),
    ).toBeUndefined();
    state.profile.session_version = 2;
    expect(
      await new Promise((resolve) => packet(['message:send'], resolve)),
    ).toBeInstanceOf(Error);
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });
  it('rejects a revoked token at handshake', async () => {
    const { gateway } = fixture();
    let middleware!: (client: Socket, next: (error?: Error) => void) => void;
    gateway.afterInit({
      use: (callback: typeof middleware) => {
        middleware = callback;
      },
    } as unknown as Server);
    const client = {
      data: {},
      handshake: {
        auth: {
          token: jwt.sign(
            {
              app: 'apticket',
              role: 'authenticated',
              aud: 'authenticated',
              email: 'chat@example.test',
              tenant_id: profile.tenant_id,
            },
            secret,
            { subject: profile.id, expiresIn: '5m' },
          ),
        },
      },
    };
    expect(
      await new Promise((resolve) =>
        middleware(client as unknown as Socket, resolve),
      ),
    ).toBeInstanceOf(Error);
  });
});
