import type { Job } from 'bullmq';
import { InterWebhookProcessor } from './inter-webhook.processor';
import type { InterWebhookJobData } from './inter-webhook.controller';
import type { SupabaseService } from '../../supabase/supabase.service';

describe('InterWebhookProcessor response validation', () => {
  const invoke = jest.fn();
  const processor = new InterWebhookProcessor({
    client: { functions: { invoke } },
  } as unknown as SupabaseService);
  const job = {
    data: { requestId: 'fixture-request', eventId: 'fixture-event' },
  } as Job<InterWebhookJobData>;

  it.each([
    null,
    [],
    'synced',
    {},
    { ok: true },
    { ok: false, state: 'synced' },
  ])(
    'retries instead of accepting an invalid response: %j',
    async (data: unknown) => {
      invoke.mockResolvedValueOnce({ data, error: null });
      await expect(processor.process(job)).rejects.toThrow(
        'inter_charge_reconciliation_pending',
      );
    },
  );

  it('requires a successful sync without a transport error', async () => {
    invoke.mockResolvedValueOnce({
      data: { ok: true, state: 'synced' },
      error: new Error('fixture unavailable'),
    });
    await expect(processor.process(job)).rejects.toThrow(
      'inter_charge_reconciliation_pending',
    );
    invoke.mockResolvedValueOnce({
      data: { ok: true, state: 'synced' },
      error: null,
    });
    await expect(processor.process(job)).resolves.toBeUndefined();
  });
});
