import { CollectionProcessor } from './collection.processor';
import { CollectionDispatchPausedError } from './collection-dispatch.service';
import type { Job } from 'bullmq';
import type { CollectionJobData } from './collection.types';

describe('CollectionProcessor', () => {
  it('preserva trabalho pausado sem marcá-lo como enviado ou falho', async () => {
    const service = {
      dispatch: jest
        .fn()
        .mockRejectedValue(new CollectionDispatchPausedError()),
      finish: jest.fn(),
    };
    const processor = new CollectionProcessor({} as never, service as never);
    await processor.process({
      name: 'dispatch',
      data: { action: { id: 'paused-action', channel: 'email' } },
    } as Job<CollectionJobData>);
    expect(service.dispatch).toHaveBeenCalledTimes(1);
    expect(service.finish).not.toHaveBeenCalled();
  });
});
