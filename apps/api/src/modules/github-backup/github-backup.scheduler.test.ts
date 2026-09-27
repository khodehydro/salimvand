import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubBackupService } from './github-backup.service';

/** Minimal stand-ins: the scheduler only needs the settings row, a job row
 *  and something that produces the archive bytes. */
function makeHarness(value: unknown) {
  const store: Record<string, unknown> = value === null ? {} : { 'github.backup': value };
  const setting = {
    findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
      where.key in store ? { key: where.key, value: store[where.key] } : null,
    ),
    upsert: vi.fn(
      async ({ where, create, update }: { where: { key: string }; create: any; update: any }) => {
        store[where.key] = { ...(update?.value ?? create.value) };
        return { key: where.key, value: store[where.key] };
      },
    ),
  };
  const backupJob = {
    create: vi.fn(async () => ({ id: 1n })),
    update: vi.fn(async () => ({})),
  };
  const prisma = { setting, backupJob } as never;
  const productsBackup = { buildBackup: vi.fn(async () => Buffer.from('zip-bytes')) } as never;
  return {
    service: new GithubBackupService(prisma, productsBackup),
    productsBackup,
    setting,
    store,
  };
}

const enabledConfig = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  repo: 'owner/backup',
  branch: 'main',
  token: 'ghp_token',
  intervalMinutes: 30,
  pathPrefix: 'backups',
  includeImages: false,
  lastRunAt: null,
  ...overrides,
});

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

describe('GithubBackupService scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ content: { html_url: 'https://github.com/x', sha: 'abc' } }),
        text: async () => '{}',
      })),
    );
    delete process.env.ENABLE_QUEUE_WORKER;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('arms the timer on boot and pushes an archive when none was ever taken', async () => {
    const { service, productsBackup } = makeHarness(enabledConfig());
    service.onModuleInit();
    await vi.advanceTimersByTimeAsync(12_000); // first pass 10s after boot
    expect(productsBackup.buildBackup).toHaveBeenCalledTimes(1);
    // and it keeps ticking afterwards
    await vi.advanceTimersByTimeAsync(30_000 * 3);
    expect(productsBackup.buildBackup).toHaveBeenCalledTimes(1); // not due yet (30m interval)
    service.onModuleDestroy();
  });

  it('records nextRunAt and a skip reason while the interval has not elapsed', async () => {
    const { service, productsBackup, store } = makeHarness(
      enabledConfig({ lastRunAt: minutesAgo(5) }),
    );
    service.onModuleInit();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(productsBackup.buildBackup).not.toHaveBeenCalled();
    const saved = store['github.backup'] as Record<string, unknown>;
    expect(saved.lastSkipReason).toBe('not-due');
    expect(saved.lastTickAt).toBeTruthy();
    expect(new Date(saved.nextRunAt as string).getTime()).toBeGreaterThan(Date.now());
    service.onModuleDestroy();
  });

  it('runs again once the interval has elapsed', async () => {
    const { service, productsBackup } = makeHarness(enabledConfig({ lastRunAt: minutesAgo(31) }));
    service.onModuleInit();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(productsBackup.buildBackup).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
  });

  it('records «disabled» when the switch is off — and never uploads', async () => {
    const { service, productsBackup, store } = makeHarness(enabledConfig({ enabled: false }));
    service.onModuleInit();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(productsBackup.buildBackup).not.toHaveBeenCalled();
    expect((store['github.backup'] as Record<string, unknown>).lastSkipReason).toBe('disabled');
    service.onModuleDestroy();
  });

  it('records «missing-config» when the token is empty', async () => {
    const { service, store } = makeHarness(enabledConfig({ token: '' }));
    service.onModuleInit();
    await vi.advanceTimersByTimeAsync(12_000);
    expect((store['github.backup'] as Record<string, unknown>).lastSkipReason).toBe(
      'missing-config',
    );
    service.onModuleDestroy();
  });

  it('does not arm a second scheduler inside the queue worker', async () => {
    const argv = process.argv;
    process.argv = ['node', '/opt/salimvand/apps/api/dist/worker.js'];
    process.env.ENABLE_QUEUE_WORKER = 'true';
    try {
      const { service, productsBackup, setting } = makeHarness(enabledConfig());
      service.onModuleInit();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(productsBackup.buildBackup).not.toHaveBeenCalled();
      expect(setting.upsert).not.toHaveBeenCalled();
    } finally {
      process.argv = argv;
      delete process.env.ENABLE_QUEUE_WORKER;
    }
  });

  it('keeps the scheduler when the API drains the queue too (.env flag)', async () => {
    const argv = process.argv;
    process.argv = ['node', '/opt/salimvand/apps/api/dist/main.js'];
    process.env.ENABLE_QUEUE_WORKER = 'true';
    try {
      const { service, productsBackup } = makeHarness(enabledConfig());
      service.onModuleInit();
      await vi.advanceTimersByTimeAsync(12_000);
      expect(productsBackup.buildBackup).toHaveBeenCalledTimes(1);
      service.onModuleDestroy();
    } finally {
      process.argv = argv;
      delete process.env.ENABLE_QUEUE_WORKER;
    }
  });

  it('keeps ticking after a tick throws — one failure never stops the schedule', async () => {
    const { service, setting, productsBackup } = makeHarness(enabledConfig());
    const realFindUnique = setting.findUnique;
    let calls = 0;
    setting.findUnique = vi.fn(async (args: any) => {
      calls += 1;
      // Call 1 is the boot-time diagnostics write; break the first real tick
      // (call 2) so the loop has to survive it.
      if (calls === 2) throw new Error('db hiccup');
      return realFindUnique(args);
    });
    service.onModuleInit();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(productsBackup.buildBackup).not.toHaveBeenCalled();
    // next pass, 30s later, must still run
    await vi.advanceTimersByTimeAsync(30_000);
    expect(productsBackup.buildBackup).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
  });

  it('runs immediately when the config is saved with a due backup', async () => {
    const { service, productsBackup } = makeHarness(enabledConfig({ enabled: false }));
    service.onModuleInit();
    await service.saveConfig({ enabled: true, intervalMinutes: 30 }, 'user-1');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(productsBackup.buildBackup).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
  });

  it('labels every run auto or manual', async () => {
    const { service, store } = makeHarness(enabledConfig());
    service.onModuleInit();
    await vi.advanceTimersByTimeAsync(12_000);
    expect((store['github.backup'] as Record<string, unknown>).lastTrigger).toBe('auto');
    await service.runManual('user-1');
    expect((store['github.backup'] as Record<string, unknown>).lastTrigger).toBe('manual');
    service.onModuleDestroy();
  });

  it('tickNow reports the decision without waiting for the timer', async () => {
    const { service } = makeHarness(enabledConfig({ lastRunAt: minutesAgo(2) }));
    const skipped = await service.tickNow();
    expect(skipped.data).toEqual({ ran: false, reason: 'not-due' });
    const { service: dueService } = makeHarness(enabledConfig({ lastRunAt: minutesAgo(45) }));
    const ran = await dueService.tickNow();
    expect(ran.data.ran).toBe(true);
  });
});

describe('GithubBackupService due-time guards', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ content: { sha: 'abc' } }),
        text: async () => '{}',
      })),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('never lets a clock jump postpone the schedule', async () => {
    // lastRunAt 10 minutes in the FUTURE (server clock was corrected).
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    const store: Record<string, unknown> = {
      'github.backup': {
        enabled: true,
        repo: 'owner/backup',
        branch: 'main',
        token: 'ghp_token',
        intervalMinutes: 30,
        pathPrefix: 'backups',
        includeImages: false,
        lastRunAt: future,
      },
    };
    const setting = {
      findUnique: vi.fn(async ({ where }: any) =>
        where.key in store ? { key: where.key, value: store[where.key] } : null,
      ),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        store[where.key] = { ...(update?.value ?? create.value) };
        return { key: where.key, value: store[where.key] };
      }),
    };
    const productsBackup = { buildBackup: vi.fn(async () => Buffer.from('zip')) } as never;
    const service = new GithubBackupService(
      {
        setting,
        backupJob: { create: vi.fn(async () => ({ id: 1n })), update: vi.fn(async () => ({})) },
      } as never,
      productsBackup,
    );
    const result = await service.tickNow();
    expect(result.data.ran).toBe(true);
  });
});
