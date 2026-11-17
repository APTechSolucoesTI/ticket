import { Injectable } from '@nestjs/common';
import { RedisService } from '../queue/redis.service';
import { SupabaseService } from '../supabase/supabase.service';

export const READINESS_TIMEOUT_MS = 2000;
export const READINESS_CACHE_MS = 1000;
type DependencyState = 'up' | 'down';
export type ReadinessReport = {
  ok: boolean;
  checks: { database: DependencyState; redis: DependencyState };
};

/** Process-local coalescing bounds public probe traffic without storing errors. */
@Injectable()
export class ReadinessService {
  private cached: { expires: number; report: ReadinessReport } | undefined;
  private pending: Promise<ReadinessReport> | undefined;
  constructor(
    private readonly redis: RedisService,
    private readonly supabase: SupabaseService,
  ) {}

  check(): Promise<ReadinessReport> {
    if (this.cached && this.cached.expires > Date.now())
      return Promise.resolve(this.cached.report);
    if (this.pending) return this.pending;
    this.pending = this.inspect()
      .then((report) => {
        this.cached = { expires: Date.now() + READINESS_CACHE_MS, report };
        return report;
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }

  private async inspect(): Promise<ReadinessReport> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), READINESS_TIMEOUT_MS);
    try {
      const [database, redis] = await Promise.all([
        this.bounded(controller.signal, () =>
          this.databaseProbe(controller.signal),
        ),
        this.bounded(controller.signal, () =>
          this.redisProbe(controller.signal),
        ),
      ]);
      return {
        ok: database && redis,
        checks: {
          database: database ? 'up' : 'down',
          redis: redis ? 'up' : 'down',
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // Abort alone does not settle an SDK that ignores the signal. Bound both the
  // result and the resource lifetime, including delayed promise rejections.
  private bounded(
    signal: AbortSignal,
    probe: () => Promise<boolean>,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve(false);
        return;
      }
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abort);
        resolve(value);
      };
      const abort = () => finish(false);
      signal.addEventListener('abort', abort, { once: true });
      void Promise.resolve()
        .then(() => (signal.aborted ? false : probe()))
        .then(finish, () => finish(false));
    });
  }

  private async databaseProbe(signal: AbortSignal): Promise<boolean> {
    const { error } = await this.supabase.client
      .from('tenants')
      .select('id', { head: true })
      .limit(0)
      .abortSignal(signal);
    return error === null && !signal.aborted;
  }

  private async redisProbe(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted || this.redis.client.status !== 'ready') return false;
    const probe = this.redis.client.duplicate({
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      connectTimeout: READINESS_TIMEOUT_MS,
      commandTimeout: READINESS_TIMEOUT_MS,
      disconnectTimeout: 0,
      retryStrategy: () => null,
    });
    const disconnect = () => {
      try {
        probe.disconnect();
      } catch {
        /* A probe must not terminate the API during cleanup. */
      }
    };
    probe.on('error', () => undefined);
    signal.addEventListener('abort', disconnect, { once: true });
    try {
      if (signal.aborted) return false;
      await probe.connect();
      if (signal.aborted) return false;
      const result = await probe.ping();
      return (
        result === 'PONG' &&
        !signal.aborted &&
        this.redis.client.status === 'ready'
      );
    } finally {
      signal.removeEventListener('abort', disconnect);
      disconnect();
    }
  }
}
