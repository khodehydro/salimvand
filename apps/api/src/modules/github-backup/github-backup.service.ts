import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { ProductsBackupService } from '../catalog/products-backup.service';

type GithubBackupConfig = {
  enabled: boolean;
  repo: string; // e.g. khodehydro/salimvand-backup
  branch: string; // main
  token: string; // ghp_... (PAT)
  intervalMinutes: number; // 30
  pathPrefix: string; // backups
  includeImages: boolean;
  lastRunAt?: string | null;
  lastFile?: string | null;
  lastStatus?: string | null;
  lastError?: string | null;
  /** «auto» or «manual» — what triggered the last archive. */
  lastTrigger?: string | null;
  /** Scheduler health, written on every tick so the panel can prove the loop
   *  is alive (and show why a tick decided to skip the run). */
  lastTickAt?: string | null;
  nextRunAt?: string | null;
  lastSkipReason?: string | null;
  schedulerBootedAt?: string | null;
  tickCount?: number;
};

const DEFAULT_CONFIG: GithubBackupConfig = {
  enabled: false,
  repo: 'khodehydro/salimvand-backup',
  branch: 'main',
  token: '',
  intervalMinutes: 30,
  pathPrefix: 'backups',
  includeImages: true,
  lastRunAt: null,
  lastFile: null,
  lastStatus: null,
  lastError: null,
  lastTrigger: null,
  lastTickAt: null,
  nextRunAt: null,
  lastSkipReason: null,
  schedulerBootedAt: null,
  tickCount: 0,
};

const SETTING_KEY = 'github.backup';

/** The queue worker boots the very same AppModule (`dist/worker.js`), so both
 *  processes used to own a timer and every interval pushed two identical
 *  archives. Only the API process (`dist/main.js`) schedules backups.
 *  `ENABLE_QUEUE_WORKER` alone is not enough: the operator may set it in .env
 *  so the API drains the queue too — that process is still the API. */
const isQueueWorkerProcess = () =>
  (process.argv[1] ?? '').endsWith('/worker.js') && process.env.ENABLE_QUEUE_WORKER === 'true';

@Injectable()
export class GithubBackupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GithubBackupService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** One tick at a time — the manual «run now» button must never overlap the
   *  scheduler's own tick. */
  private ticking = false;
  /** How often the due-time is evaluated. Short enough that a due backup does
   *  not wait a whole minute. */
  private readonly tickMs = 30_000;
  private readonly bootedAt = new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly productsBackup: ProductsBackupService,
  ) {}

  onModuleInit() {
    // The queue worker boots the same AppModule; two schedulers would push
    // two identical archives every interval, so only the API process owns the
    // timer.
    if (isQueueWorkerProcess()) {
      this.logger.log('GitHub backup scheduler: disabled in the worker process');
      return;
    }
    this.logger.log(`GitHub backup scheduler armed — checking every ${this.tickMs / 1000}s`);
    void this.persistDiagnostics({ schedulerBootedAt: this.bootedAt.toISOString() }).catch((e) =>
      this.logger.error(`scheduler boot state failed: ${(e as Error).message}`),
    );
    // First check shortly after boot: a server that was down past its due
    // time catches up instead of waiting for the next window.
    this.scheduleNext(10_000);
  }

  onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Re-arms the loop. Every path (success, failure, skip) goes through here,
   *  so a single bad tick can never stop the schedule for good. */
  private scheduleNext(delayMs: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.runTickLoop();
    }, delayMs);
    // Never hold the process open just for the timer.
    this.timer.unref?.();
  }

  private async runTickLoop() {
    try {
      await this.tick();
    } catch (e) {
      this.logger.error(`GitHub backup tick failed: ${(e as Error).message}`);
    } finally {
      this.scheduleNext(this.tickMs);
    }
  }

  /** Scheduler health only — polled by the panel without overwriting the
   *  operator's half-typed settings form. */
  async getSchedulerStatus() {
    const cfg = await this.getConfig();
    const lastTick = cfg.lastTickAt ? new Date(cfg.lastTickAt).getTime() : null;
    const staleAfterMs = Math.max(this.tickMs * 6, 180_000);
    return {
      enabled: cfg.enabled,
      intervalMinutes: cfg.intervalMinutes,
      lastRunAt: cfg.lastRunAt ?? null,
      lastRunStatus: cfg.lastStatus ?? null,
      lastError: cfg.lastError ?? null,
      lastFile: cfg.lastFile ?? null,
      lastTrigger: cfg.lastTrigger ?? null,
      lastTickAt: cfg.lastTickAt ?? null,
      nextRunAt: cfg.nextRunAt ?? null,
      lastSkipReason: cfg.lastSkipReason ?? null,
      tickCount: cfg.tickCount ?? 0,
      schedulerBootedAt: cfg.schedulerBootedAt ?? null,
      schedulerAlive: lastTick !== null && Date.now() - lastTick < staleAfterMs,
      schedulerOwnedHere: !isQueueWorkerProcess(),
    };
  }

  /** Manual «check now» from the panel — same decision path as the timer. */
  async tickNow() {
    if (this.ticking) return { ok: true, data: { ran: false, reason: 'busy' } };
    const result = await this.tick();
    return { ok: true, data: result };
  }

  /** Merges scheduler state into the stored config without touching the
   *  user's settings. */
  private async persistDiagnostics(patch: Partial<GithubBackupConfig>) {
    const current = await this.getConfig();
    const next: GithubBackupConfig = { ...current, ...patch };
    await this.prisma.setting.upsert({
      where: { key: SETTING_KEY },
      update: { value: next as never },
      create: { key: SETTING_KEY, value: next as never },
    });
    return next;
  }

  /** When the next archive is due, given the last run and the interval. */
  private static dueAt(cfg: GithubBackupConfig, now: Date) {
    const last = cfg.lastRunAt ? new Date(cfg.lastRunAt) : null;
    // No previous run at all → it is already due.
    if (!last || Number.isNaN(last.getTime())) return now;
    const due = new Date(last.getTime() + cfg.intervalMinutes * 60_000);
    // A clock jump (NTP correction) can leave lastRunAt in the future; never
    // let that postpone the schedule by more than one extra interval.
    if (due.getTime() - now.getTime() > cfg.intervalMinutes * 60_000) return now;
    return due;
  }

  async getConfig(): Promise<GithubBackupConfig> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    if (!row || typeof row.value !== 'object') return { ...DEFAULT_CONFIG };
    const v = row.value as Partial<GithubBackupConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...v,
      repo: (v.repo ?? DEFAULT_CONFIG.repo).trim(),
      branch: (v.branch ?? DEFAULT_CONFIG.branch).trim() || 'main',
      token: (v.token ?? '').trim(),
      intervalMinutes: Math.max(5, Math.min(1440, Number(v.intervalMinutes ?? 30) || 30)),
      pathPrefix: (v.pathPrefix ?? DEFAULT_CONFIG.pathPrefix).trim() || 'backups',
      includeImages: v.includeImages ?? true,
    };
  }

  async getPublicConfig() {
    const cfg = await this.getConfig();
    const masked = cfg.token ? `${cfg.token.slice(0, 6)}...${cfg.token.slice(-4)}` : '';
    // A tick newer than three intervals means the loop is alive; anything
    // older means the process is not scheduling (restart loop, crash, …).
    const lastTick = cfg.lastTickAt ? new Date(cfg.lastTickAt).getTime() : null;
    const staleAfterMs = Math.max(this.tickMs * 6, 180_000);
    return {
      ...cfg,
      token: undefined,
      tokenMasked: masked,
      hasToken: Boolean(cfg.token),
      // Scheduler health for the panel.
      schedulerOwnedHere: !isQueueWorkerProcess(),
      schedulerAlive: lastTick !== null && Date.now() - lastTick < staleAfterMs,
      schedulerBootedAt: cfg.schedulerBootedAt ?? null,
    };
  }

  async saveConfig(input: Partial<GithubBackupConfig>, userId: string) {
    const current = await this.getConfig();
    const next: GithubBackupConfig = {
      ...current,
      ...input,
      repo: (input.repo ?? current.repo).trim(),
      branch: (input.branch ?? current.branch).trim() || 'main',
      token: input.token !== undefined ? String(input.token).trim() : current.token,
      intervalMinutes: input.intervalMinutes !== undefined ? Math.max(5, Math.min(1440, Number(input.intervalMinutes) || 30)) : current.intervalMinutes,
      pathPrefix: (input.pathPrefix ?? current.pathPrefix).trim() || 'backups',
      includeImages: input.includeImages ?? current.includeImages,
    };

    if (!next.repo || !next.repo.includes('/')) throw new BadRequestException('نام ریپازیتوری باید به شکل owner/repo باشد');
    if (next.enabled && !next.token) throw new BadRequestException('برای فعال‌سازی، توکن GitHub لازم است');

    await this.prisma.setting.upsert({
      where: { key: SETTING_KEY },
      update: { value: next as never, updatedById: userId },
      create: { key: SETTING_KEY, value: next as never, updatedById: userId },
    });

    // Turning the scheduler on (or shortening the interval) must not wait for
    // the next 30s check: recompute the due time and, when it is already in
    // the past, run the check immediately.
    if (next.enabled && next.token && next.repo) {
      const due = GithubBackupService.dueAt(next, new Date());
      await this.persistDiagnostics({ nextRunAt: due.toISOString(), lastSkipReason: null });
      if (due.getTime() <= Date.now()) {
        this.logger.log('GitHub backup: config saved and backup is due — running now');
        this.scheduleNext(2_000);
      }
    } else {
      await this.persistDiagnostics({ nextRunAt: null, lastSkipReason: 'disabled' });
    }

    return this.getPublicConfig();
  }

  /**
   * One scheduler pass: records that the loop is alive, decides whether an
   * archive is due and — only then — builds and pushes it. The reason for
   * every skip is stored so the panel can show «چرا اجرا نشد» instead of
   * leaving the operator guessing.
   */
  private async tick(): Promise<{ ran: boolean; reason: string | null }> {
    if (this.ticking) return { ran: false, reason: 'busy' };
    this.ticking = true;
    const now = new Date();
    try {
      let cfg: GithubBackupConfig;
      try {
        cfg = await this.getConfig();
      } catch (e) {
        this.logger.error(`GitHub backup tick: config unreadable ${(e as Error).message}`);
        return { ran: false, reason: 'config-error' };
      }

      const diagnostics: Partial<GithubBackupConfig> = {
        lastTickAt: now.toISOString(),
        tickCount: (cfg.tickCount ?? 0) + 1,
        schedulerBootedAt: cfg.schedulerBootedAt ?? this.bootedAt.toISOString(),
      };

      if (this.running) {
        await this.persistDiagnostics({ ...diagnostics, lastSkipReason: 'busy' });
        return { ran: false, reason: 'busy' };
      }
      if (!cfg.enabled) {
        await this.persistDiagnostics({
          ...diagnostics,
          lastSkipReason: 'disabled',
          nextRunAt: null,
        });
        return { ran: false, reason: 'disabled' };
      }
      if (!cfg.token || !cfg.repo) {
        await this.persistDiagnostics({
          ...diagnostics,
          lastSkipReason: 'missing-config',
          nextRunAt: null,
        });
        this.logger.warn('GitHub backup tick: enabled but token/repo missing');
        return { ran: false, reason: 'missing-config' };
      }

      const due = GithubBackupService.dueAt(cfg, now);
      if (due.getTime() > now.getTime()) {
        await this.persistDiagnostics({
          ...diagnostics,
          lastSkipReason: 'not-due',
          nextRunAt: due.toISOString(),
        });
        return { ran: false, reason: 'not-due' };
      }

      this.logger.log(
        `GitHub backup tick: due — pushing to ${cfg.repo} (every ${cfg.intervalMinutes}m, includeImages=${cfg.includeImages})`,
      );
      try {
        await this.runBackupInternal({ ...cfg, ...diagnostics }, 'auto');
        await this.persistDiagnostics({
          lastSkipReason: null,
          nextRunAt: new Date(Date.now() + cfg.intervalMinutes * 60_000).toISOString(),
        });
        return { ran: true, reason: null };
      } catch (e) {
        this.logger.error(`GitHub backup auto failed: ${(e as Error).message}`);
        await this.persistDiagnostics({
          lastSkipReason: 'failed',
          nextRunAt: new Date(Date.now() + cfg.intervalMinutes * 60_000).toISOString(),
        });
        return { ran: false, reason: 'failed' };
      }
    } finally {
      this.ticking = false;
    }
  }

  async runManual(userId?: string) {
    const cfg = await this.getConfig();
    if (!cfg.token) throw new BadRequestException('توکن GitHub تنظیم نشده است');
    if (!cfg.repo) throw new BadRequestException('ریپازیتوری GitHub تنظیم نشده است');
    return this.runBackupInternal(cfg, userId ? `manual:${userId}` : 'manual');
  }

  private async runBackupInternal(cfg: GithubBackupConfig, triggeredBy: string) {
    if (this.running) throw new BadRequestException('یک پشتیبان‌گیری در حال اجرا است');
    this.running = true;

    const job = await this.prisma.backupJob.create({
      data: { kind: 'github-products', status: 'running', startedAt: new Date(), destination: cfg.repo },
    });

    try {
      // Build products zip - respect includeImages toggle to keep size small when images are many
      const buffer = await this.productsBackup.buildBackup({ includeImages: cfg.includeImages });

      // Check size - GitHub contents API limit 100MB, we warn if > 90MB
      const sizeMB = buffer.length / (1024 * 1024);
      if (sizeMB > 90) {
        this.logger.warn(`Backup size ${sizeMB.toFixed(1)}MB > 90MB, may fail on GitHub Contents API`);
      }

      // Generate filename based on Tehran time
      const now = new Date();
      const tehranFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tehran',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      // en-CA gives YYYY-MM-DD, but we need to parse parts
      const parts = tehranFormatter.formatToParts(now).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {} as Record<string, string>);
      const yyyy = parts.year;
      const mm = parts.month;
      const dd = parts.day;
      const hh = parts.hour;
      const min = parts.minute;
      const ss = parts.second;

      // Path: backups/2026/09/24/products-2026-09-24_14-30-00.zip or products-noimg-...
      const suffix = cfg.includeImages ? '' : '-noimg';
      const fileName = `products${suffix}-${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}.zip`;
      const filePath = `${cfg.pathPrefix.replace(/^\/+|\/+$/g, '')}/${yyyy}/${mm}/${dd}/${fileName}`;

      // Push to GitHub
      const result = await this.pushToGithub({
        repo: cfg.repo,
        branch: cfg.branch,
        token: cfg.token,
        path: filePath,
        content: buffer,
        message: `backup: products${cfg.includeImages ? '' : ' (no images)'} ${yyyy}-${mm}-${dd} ${hh}:${min}:${ss} Asia/Tehran [${triggeredBy}]`,
      });

      // Update config with last run info
      const updatedCfg: GithubBackupConfig = {
        ...cfg,
        lastRunAt: now.toISOString(),
        lastFile: filePath,
        lastStatus: 'success',
        lastError: null,
        lastTrigger: triggeredBy.startsWith('manual') ? 'manual' : 'auto',
        lastSkipReason: null,
        nextRunAt: new Date(now.getTime() + cfg.intervalMinutes * 60_000).toISOString(),
      };

      await this.prisma.setting.upsert({
        where: { key: SETTING_KEY },
        update: { value: updatedCfg as never },
        create: { key: SETTING_KEY, value: updatedCfg as never },
      });

      await this.prisma.backupJob.update({
        where: { id: job.id },
        data: {
          status: 'success',
          file: filePath,
          sizeBytes: BigInt(buffer.length),
          destination: cfg.repo,
          finishedAt: new Date(),
        },
      });

      this.logger.log(`GitHub backup success: ${filePath} -> ${result.commit?.sha ?? 'ok'}`);

      return {
        ok: true,
        data: {
          file: filePath,
          size: buffer.length,
          sizeMB: Number(sizeMB.toFixed(2)),
          repo: cfg.repo,
          branch: cfg.branch,
          url: result.content?.html_url ?? `https://github.com/${cfg.repo}/blob/${cfg.branch}/${filePath}`,
          commit: result.commit?.sha,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'پشتیبان‌گیری ناموفق بود';
      this.logger.error(`GitHub backup failed: ${message}`);

      const updatedCfg: GithubBackupConfig = {
        ...cfg,
        lastRunAt: new Date().toISOString(),
        lastStatus: 'failed',
        lastError: message.slice(0, 500),
        lastTrigger: triggeredBy.startsWith('manual') ? 'manual' : 'auto',
        lastSkipReason: 'failed',
      };

      await this.prisma.setting.upsert({
        where: { key: SETTING_KEY },
        update: { value: updatedCfg as never },
        create: { key: SETTING_KEY, value: updatedCfg as never },
      });

      await this.prisma.backupJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          error: message.slice(0, 500),
          finishedAt: new Date(),
        },
      });

      throw new BadRequestException(message);
    } finally {
      this.running = false;
    }
  }

  private async pushToGithub(params: {
    repo: string;
    branch: string;
    token: string;
    path: string;
    content: Buffer;
    message: string;
  }): Promise<{ content?: { html_url?: string; sha: string }; commit?: { sha: string } }> {
    const { repo, branch, token, path, content, message } = params;
    const apiBase = 'https://api.github.com';

    // Check if file exists to get sha (for update) and also get branch sha
    let existingSha: string | undefined;

    // Try to get existing file (if exists, we will update)
    try {
      const getRes = await fetch(`${apiBase}/repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${encodeURIComponent(branch)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (getRes.ok) {
        const existing = (await getRes.json()) as { sha: string };
        existingSha = existing.sha;
      }
    } catch {
      // ignore, file likely doesn't exist
    }

    // For large files, Contents API may still work up to 100MB. Use it.
    const base64 = content.toString('base64');

    const putRes = await fetch(`${apiBase}/repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        message,
        content: base64,
        branch,
        sha: existingSha,
      }),
    });

    if (!putRes.ok) {
      const errText = await putRes.text();
      let errJson: any;
      try {
        errJson = JSON.parse(errText);
      } catch {
        errJson = { message: errText };
      }
      // Provide helpful error for private repo / token issues
      if (putRes.status === 401) throw new Error('توکن GitHub نامعتبر است یا منقضی شده (401)');
      if (putRes.status === 404) throw new Error(`ریپازیتوری ${repo} یافت نشد یا توکن دسترسی ندارد (404). مطمئن شوید ریپازیتوری private است و توکن دسترسی repo دارد.`);
      if (putRes.status === 403) throw new Error(`دسترسی به ریپازیتوری مسدود شد (403): ${errJson.message ?? errText}`);
      throw new Error(`GitHub API خطا (${putRes.status}): ${errJson.message ?? errText.slice(0, 300)}`);
    }

    return (await putRes.json()) as { content?: { html_url?: string; sha: string }; commit?: { sha: string } };
  }

  async listJobs() {
    const jobs = await this.prisma.backupJob.findMany({
      where: { kind: 'github-products' },
      orderBy: { startedAt: 'desc' },
      take: 30,
    });
    return { ok: true, data: jobs.map((j: any) => ({ ...j, id: String(j.id), sizeBytes: j.sizeBytes.toString() })) };
  }
}
