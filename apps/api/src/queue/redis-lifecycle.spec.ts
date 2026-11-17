import {
  Global,
  Injectable,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RedisService } from './redis.service';

describe('shared Redis shutdown ordering', () => {
  afterEach(() => jest.useRealTimers());
  it('bounds QUIT when Redis stops answering during shutdown', async () => {
    jest.useFakeTimers();
    const client = {
      status: 'ready',
      quit: jest.fn(() => new Promise(() => {})),
      disconnect: jest.fn(),
    };
    const redis = Object.assign(
      Object.create(RedisService.prototype) as RedisService,
      { client },
    );
    const module = await Test.createTestingModule({
      providers: [{ provide: RedisService, useValue: redis }],
    }).compile();
    await module.init();
    let state = 'pending';
    void module.close().then(() => {
      state = 'closed';
    });
    await jest.advanceTimersByTimeAsync(2100);
    expect(state).toBe('closed');
    expect(client.disconnect).toHaveBeenCalled();
  });
  it('keeps Redis available until dependent consumers finish shutdown', async () => {
    const events: string[] = [];
    let closed = false;
    const client = {
      status: 'ready',
      quit: jest.fn(() => {
        events.push('quit');
        closed = true;
        return Promise.resolve('OK');
      }),
      disconnect: jest.fn(() => events.push('disconnect')),
    };
    const redis = Object.assign(
      Object.create(RedisService.prototype) as RedisService,
      { client },
    );
    @Global()
    @Module({
      providers: [{ provide: RedisService, useValue: redis }],
      exports: [RedisService],
    })
    class SharedRedisModule {}
    @Injectable()
    class Consumer implements OnApplicationShutdown {
      constructor(private readonly shared: RedisService) {}
      async onApplicationShutdown() {
        await Promise.resolve();
        if (closed) throw new Error('Redis closed before consumer drain');
        expect(this.shared).toBe(redis);
        events.push('drained');
      }
    }
    @Module({ providers: [Consumer] })
    class ConsumerModule {}
    const module = await Test.createTestingModule({
      imports: [SharedRedisModule, ConsumerModule],
    }).compile();
    await module.init();
    await expect(module.close()).resolves.toBeUndefined();
    expect(events[0]).toBe('drained');
    expect(events).toContain('quit');
  });
});
