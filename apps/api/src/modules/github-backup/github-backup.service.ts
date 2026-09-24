import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
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
};

const SETTING_KEY = 'github.backup';

@Injectable()
export class GithubBackupService implements OnModuleInit {
  private readonly logger = new Logger(GithubBackupService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly productsBackup: ProductsBackupService,
  ) {}

  onModuleInit() {
    // Check every minute if it's time to run
    this.timer = setInterval(() => {
      void this.tick().catch((e) => this.logger.error(`tick failed: ${(e as Error).message}`));
    }, 60_000);
    // Also run tick shortly after boot
    setTimeout(() => {
      void this.tick().catch(() => undefined);
    }, 15_000);
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
    return {
      ...cfg,
      token: undefined,
      tokenMasked: masked,
      hasToken: Boolean(cfg.token),
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

    return this.getPublicConfig();
  }

  private async tick() {
    if (this.running) return;
    const cfg = await this.getConfig();
    if (!cfg.enabled) return;
    if (!cfg.token || !cfg.repo) return;

    const now = new Date();
    const lastRun = cfg.lastRunAt ? new Date(cfg.lastRunAt) : null;
    const intervalMs = cfg.intervalMinutes * 60_000;

    if (lastRun && now.getTime() - lastRun.getTime() < intervalMs) return;

    this.logger.log(`GitHub backup tick: running backup to ${cfg.repo} (interval ${cfg.intervalMinutes}m)`);
    await this.runBackupInternal(cfg, 'auto');
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
      // Build products zip
      const buffer = await this.productsBackup.buildBackup();

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

      // Path: backups/2026/09/24/products-2026-09-24_14-30-00.zip
      const fileName = `products-${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}.zip`;
      const filePath = `${cfg.pathPrefix.replace(/^\/+|\/+$/g, '')}/${yyyy}/${mm}/${dd}/${fileName}`;

      // Push to GitHub
      const result = await this.pushToGithub({
        repo: cfg.repo,
        branch: cfg.branch,
        token: cfg.token,
        path: filePath,
        content: buffer,
        message: `backup: products ${yyyy}-${mm}-${dd} ${hh}:${min}:${ss} Asia/Tehran [${triggeredBy}]`,
      });

      // Update config with last run info
      const updatedCfg: GithubBackupConfig = {
        ...cfg,
        lastRunAt: now.toISOString(),
        lastFile: filePath,
        lastStatus: 'success',
        lastError: null,
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
    return { ok: true, data: jobs.map((j) => ({ ...j, id: String(j.id), sizeBytes: j.sizeBytes.toString() })) };
  }
}
