import type { INestApplication } from '@nestjs/common';
import type { RedisIoAdapter } from '../channels/chat/redis-io.adapter';
import { startApplication } from './application-lifecycle';

function fixture() {
  const calls: string[] = [];
  const app = {
    enableShutdownHooks: jest.fn(() => calls.push('signals')),
    useWebSocketAdapter: jest.fn(() => calls.push('adapter')),
    listen: jest.fn(() => {
      calls.push('listen');
      return Promise.resolve();
    }),
    close: jest.fn(() => Promise.resolve()),
  };
  const adapter = {
    connectToRedis: jest.fn(() => {
      calls.push('connect');
      return Promise.resolve();
    }),
    dispose: jest.fn(() => Promise.resolve()),
  };
  return {
    app,
    adapter,
    calls,
    start: () =>
      startApplication(
        app as unknown as INestApplication,
        adapter as unknown as RedisIoAdapter,
        3001,
      ),
  };
}
describe('application lifecycle boundary', () => {
  afterEach(() => jest.useRealTimers());
  it('installs signal handling and awaits Redis before listening', async () => {
    const f = fixture();
    await f.start();
    expect(f.calls).toEqual(['signals', 'adapter', 'connect', 'listen']);
    expect(f.app.enableShutdownHooks).toHaveBeenCalledWith([
      'SIGTERM',
      'SIGINT',
    ]);
  });
  it('cleans resources and reports a generic error on startup failure', async () => {
    const f = fixture();
    f.adapter.connectToRedis.mockRejectedValue(
      new Error('private-redis-url-password'),
    );
    await expect(f.start()).rejects.toThrow('api_startup_failed');
    expect(f.app.listen).not.toHaveBeenCalled();
    expect(f.adapter.dispose).toHaveBeenCalled();
    expect(f.app.close).toHaveBeenCalled();
  });
  it('does not wait forever for shutdown callbacks after a failed startup', async () => {
    jest.useFakeTimers();
    const f = fixture();
    f.app.listen.mockRejectedValue(new Error('listen failed'));
    f.app.close.mockImplementation(() => new Promise(() => {}));
    let result = 'pending';
    void f.start().then(
      () => {
        result = 'ready';
      },
      () => {
        result = 'failed';
      },
    );
    await jest.advanceTimersByTimeAsync(2100);
    expect(result).toBe('failed');
    expect(f.adapter.dispose).toHaveBeenCalled();
  });
});
