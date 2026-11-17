import { RedisService } from './redis.service';

function fixture(
  options: {
    count?: number;
    ttl?: number;
    failExpire?: boolean;
    result?: unknown;
  } = {},
) {
  let count = options.count ?? 0,
    ttl = options.ttl ?? -1;
  const client = {
    incr: jest.fn(() => Promise.resolve(++count)),
    expire: jest.fn((_key: string, seconds: number) => {
      if (options.failExpire)
        return Promise.reject(new Error('connection lost before expiry'));
      ttl = seconds;
      return Promise.resolve(1);
    }),
    ttl: jest.fn(() => Promise.resolve(ttl)),
    // Atomic Redis EVAL is the I/O boundary here. The actual Lua is exercised
    // separately, including Redis integration in CI.
    eval: jest.fn(
      (_script: string, _keys: number, _key: string, seconds: number) => {
        count++;
        if (ttl < 0) ttl = seconds;
        return Promise.resolve(options.result ?? [count, ttl]);
      },
    ),
  };
  const service = Object.assign(
    Object.create(RedisService.prototype) as RedisService,
    { client },
  );
  return { service, client, state: () => ({ count, ttl }) };
}

describe('Redis fixed-window rate limit', () => {
  it('does not leave a persistent counter when the separate expiry command fails', async () => {
    const f = fixture({ failExpire: true });
    await expect(f.service.checkRateLimit('synthetic', 2, 60)).resolves.toEqual(
      { allowed: true, retryAfterSeconds: 0 },
    );
    expect(f.state()).toEqual({ count: 1, ttl: 60 });
    expect(f.client.incr).not.toHaveBeenCalled();
    expect(f.client.expire).not.toHaveBeenCalled();
  });
  it('repairs a historical counter without expiration', async () => {
    const f = fixture({ count: 5, ttl: -1 });
    await expect(f.service.checkRateLimit('synthetic', 2, 60)).resolves.toEqual(
      { allowed: false, retryAfterSeconds: 60 },
    );
    expect(f.state().ttl).toBe(60);
  });
  it('preserves the remaining window and returns at least one second at its boundary', async () => {
    await expect(
      fixture({ count: 5, ttl: 17 }).service.checkRateLimit('synthetic', 2, 60),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 17 });
    await expect(
      fixture({ count: 5, ttl: 0 }).service.checkRateLimit('synthetic', 2, 60),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 1 });
  });
  it.each([
    [0, 60],
    [2, 0],
    [2, -1],
    [1.5, 60],
    [2, 2147483648],
  ])(
    'rejects invalid configuration %s/%s before Redis',
    async (limit, seconds) => {
      const f = fixture();
      await expect(
        f.service.checkRateLimit('synthetic', limit, seconds),
      ).rejects.toThrow();
      expect(f.client.eval).not.toHaveBeenCalled();
      expect(f.client.incr).not.toHaveBeenCalled();
    },
  );
  it.each([
    { result: [] },
    { result: [1] },
    { result: ['1', 60] },
    { result: [1, -1] },
    { result: [NaN, 60] },
  ])(
    'does not allow a malformed Redis response $result',
    async ({ result }) => {
      const f = fixture({ result });
      await expect(
        f.service.checkRateLimit('synthetic', 2, 60),
      ).rejects.toThrow();
    },
  );
});
