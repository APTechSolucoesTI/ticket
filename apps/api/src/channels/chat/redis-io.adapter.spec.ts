import { EventEmitter } from 'node:events';
import type { INestApplicationContext } from '@nestjs/common';
import { RedisIoAdapter } from './redis-io.adapter';

let mode: 'ready' | 'hang' | 'error' = 'ready';
const clients: FakeRedis[] = [];
class FakeRedis extends EventEmitter {
  status = 'wait';
  connect = jest.fn(() => {
    if (mode === 'hang') return new Promise<void>(() => {});
    if (mode === 'error')
      return Promise.reject(new Error('private-redis-url-and-password'));
    this.status = 'ready';
    this.emit('ready');
    return Promise.resolve();
  });
  disconnect = jest.fn(() => {
    this.status = 'end';
  });
  constructor(
    readonly url: string,
    readonly options: { lazyConnect?: boolean } = {},
  ) {
    super();
    clients.push(this);
    if (!options.lazyConnect && mode === 'ready')
      queueMicrotask(() => {
        this.status = 'ready';
        this.emit('ready');
      });
  }
  duplicate() {
    return new FakeRedis(this.url, this.options);
  }
}
jest.mock('ioredis', () => ({
  __esModule: true,
  default: class {
    constructor(url: string, options: { lazyConnect?: boolean }) {
      return new FakeRedis(url, options);
    }
  },
}));

describe('Redis Socket.IO lifecycle', () => {
  let adapter: RedisIoAdapter;
  beforeEach(() => {
    mode = 'ready';
    clients.length = 0;
    adapter = new RedisIoAdapter({
      get: () => ({ get: () => 'redis://fixture.invalid:6381/4' }),
    } as unknown as INestApplicationContext);
  });
  afterEach(async () => {
    await adapter.dispose();
    jest.useRealTimers();
  });
  it('closes both owned clients and is safe to dispose twice', async () => {
    await adapter.connectToRedis();
    await adapter.dispose();
    await adapter.dispose();
    expect(clients).toHaveLength(2);
    for (const client of clients)
      expect(client.disconnect).toHaveBeenCalledTimes(1);
  });
  it('shares one attempt between concurrent startup calls', async () => {
    await Promise.all([adapter.connectToRedis(), adapter.connectToRedis()]);
    expect(clients).toHaveLength(2);
  });
  it('rejects hanging startup within five seconds and disconnects both clients', async () => {
    jest.useFakeTimers();
    mode = 'hang';
    let result = 'pending';
    void adapter.connectToRedis().then(
      () => {
        result = 'ready';
      },
      () => {
        result = 'failed';
      },
    );
    await jest.advanceTimersByTimeAsync(5001);
    expect(result).toBe('failed');
    expect(clients.every((client) => client.status === 'end')).toBe(true);
  });
  it('cancels startup when disposed and does not resurrect the adapter', async () => {
    mode = 'hang';
    let result = 'pending';
    void adapter.connectToRedis().then(
      () => {
        result = 'ready';
      },
      () => {
        result = 'failed';
      },
    );
    await adapter.dispose();
    await Promise.resolve();
    await Promise.resolve();
    expect(result).toBe('failed');
    await expect(adapter.connectToRedis()).rejects.toThrow();
  });
  it('sanitizes a failed attempt and allows a new attempt', async () => {
    mode = 'error';
    const failed = adapter.connectToRedis();
    await expect(failed).rejects.toThrow('chat_redis_startup_failed');
    expect(clients.every((client) => client.status === 'end')).toBe(true);
    mode = 'ready';
    await adapter.connectToRedis();
    expect(clients).toHaveLength(4);
  });
});
