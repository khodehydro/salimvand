import { describe, expect, it, vi } from 'vitest';
import {
  BulkData,
  BulkRunnerDeps,
  initialBulkProgress,
  runBulkPublish,
} from './bulk-publish.runner';

function setup(count: number) {
  let now = 0;
  const data: BulkData = {
    filters: { mode: 'all' },
    products: Array.from({ length: count }, (_, index) => ({
      id: `p${index}`,
      code: `P-${index}`,
    })),
    platforms: ['telegram', 'bale'],
    progress: initialBulkProgress(),
  };
  const saves: BulkData[] = [];
  const job = {
    data,
    updateData: vi.fn(async (next: BulkData) => {
      job.data = structuredClone(next);
      saves.push(structuredClone(next));
    }),
  };
  const deps: BulkRunnerDeps = {
    publish: vi.fn(async () => ({ ok: true })),
    eligible: vi.fn(async () => true),
    cancelled: vi.fn(async () => false),
    sleep: vi.fn(async (ms) => {
      now += ms;
    }),
    now: () => now,
  };
  return { job, deps, saves };
}

describe('bulk publishing runner', () => {
  it('publishes 200 unique products in exactly 20 sequential batches', async () => {
    const { job, deps, saves } = setup(200);
    let active = 0,
      peak = 0;
    vi.mocked(deps.publish).mockImplementation(async (id, platform) => {
      active++;
      peak = Math.max(peak, active);
      // Every provider call has already persisted its in-flight marker.
      expect(job.data.progress.inFlight).toBe(platform);
      expect(job.data.products[job.data.progress.cursor].id).toBe(id);
      await Promise.resolve();
      active--;
      return { ok: true };
    });
    await runBulkPublish(job, deps);
    expect(peak).toBe(1);
    expect(deps.publish).toHaveBeenCalledTimes(400);
    expect(
      new Set(vi.mocked(deps.publish).mock.calls.map(([id, platform]) => `${id}-${platform}`)).size,
    ).toBe(400);
    const pausedAfter = new Set(
      saves.filter((save) => save.progress.nextBatchAt).map((save) => save.progress.cursor),
    );
    expect([...pausedAfter]).toEqual(Array.from({ length: 19 }, (_, index) => (index + 1) * 10));
    expect(job.data.progress).toMatchObject({
      status: 'completed',
      cursor: 200,
      sent: { telegram: 200, bale: 200 },
    });
  });

  it('supports a final partial batch and only selected platforms', async () => {
    const { job, deps, saves } = setup(23);
    job.data.platforms = ['bale'];
    await runBulkPublish(job, deps);
    expect(deps.publish).toHaveBeenCalledTimes(23);
    expect(vi.mocked(deps.publish).mock.calls.every(([, platform]) => platform === 'bale')).toBe(
      true,
    );
    expect(
      new Set(saves.filter((s) => s.progress.nextBatchAt).map((s) => s.progress.cursor)),
    ).toEqual(new Set([10, 20]));
  });

  it('continues after a provider rejection without repeating the successful channel', async () => {
    const { job, deps } = setup(2);
    vi.mocked(deps.publish).mockImplementation(async (_id, platform) =>
      platform === 'telegram' ? { ok: false, reason: 'provider rejected' } : { ok: true },
    );
    await runBulkPublish(job, deps);
    expect(job.data.progress.failed.telegram).toBe(2);
    expect(job.data.progress.sent.bale).toBe(2);
    expect(job.data.progress.issues).toHaveLength(2);
    expect(job.data.progress.status).toBe('completed');
  });

  it('resumes at the saved cursor and never retries an ambiguous in-flight send', async () => {
    const { job, deps } = setup(3);
    job.data.progress.cursor = 1;
    job.data.progress.sent = { telegram: 1, bale: 2 };
    job.data.progress.doneChannels = ['bale'];
    job.data.progress.inFlight = 'telegram';
    await runBulkPublish(job, deps);
    expect(deps.publish).toHaveBeenCalledTimes(2);
    expect(deps.publish).toHaveBeenCalledWith('p2', 'telegram');
    expect(deps.publish).not.toHaveBeenCalledWith('p1', 'telegram');
    expect(job.data.progress.failed.telegram).toBe(1);
    expect(job.data.progress.issues[0].reason).toContain('نامشخص');
  });

  it('does not call the provider if its pre-send checkpoint cannot be persisted', async () => {
    const { job, deps } = setup(2);
    job.updateData.mockRejectedValueOnce(new Error('Redis disconnected'));
    await expect(runBulkPublish(job, deps)).rejects.toThrow('Redis disconnected');
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it('can stop between channels without touching subsequent products', async () => {
    const { job, deps } = setup(2);
    let cancel = false;
    vi.mocked(deps.cancelled).mockImplementation(async () => cancel);
    vi.mocked(deps.publish).mockImplementation(async () => {
      cancel = true;
      return { ok: true };
    });
    await runBulkPublish(job, deps);
    expect(deps.publish).toHaveBeenCalledTimes(1);
    expect(job.data.progress.status).toBe('cancelled');
    expect(job.data.progress.sent.telegram).toBe(1);
  });

  it('stops promptly during the pause after ten products', async () => {
    const { job, deps } = setup(20);
    vi.mocked(deps.cancelled).mockImplementation(async () => job.data.progress.cursor === 10);
    await runBulkPublish(job, deps);
    expect(deps.publish).toHaveBeenCalledTimes(20);
    expect(job.data.progress.status).toBe('cancelled');
    expect(job.data.progress.nextBatchAt).toBeUndefined();
  });

  it('skips products deactivated or deleted after the snapshot', async () => {
    const { job, deps } = setup(2);
    vi.mocked(deps.eligible).mockImplementation(async (id) => id !== 'p0');
    await runBulkPublish(job, deps);
    expect(deps.publish).toHaveBeenCalledTimes(2);
    expect(job.data.progress.skipped).toEqual({ telegram: 1, bale: 1 });
  });

  it('bounds error details to the last 100 without losing counters', async () => {
    const { job, deps } = setup(70);
    vi.mocked(deps.publish).mockResolvedValue({ ok: false, reason: 'failure' });
    await runBulkPublish(job, deps);
    expect(job.data.progress.issues).toHaveLength(100);
    expect(job.data.progress.failed).toEqual({ telegram: 70, bale: 70 });
  });
});
