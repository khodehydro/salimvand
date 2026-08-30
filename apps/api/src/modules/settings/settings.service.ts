import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { writeAudit } from '../../common/audit/audit-log';

const allowedKeys = new Set([
  'store.profile',
  'store.pricing',
  'store.trust_video',
  'sms.templates',
  'integrations.telegram',
  'integrations.bale',
  'inventory.default_min_stock',
  'backup.schedule',
]);

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const rows = await this.prisma.setting.findMany({ orderBy: { key: 'asc' } });
    return { ok: true, data: Object.fromEntries(rows.map((row) => [row.key, row.value])) };
  }

  async backupStatus() {
    try {
      const raw = await readFile(
        process.env.BACKUP_STATUS_FILE ?? '/var/lib/salimvand/backup-status.json',
        'utf8',
      );
      return {
        ok: true,
        data: JSON.parse(raw) as {
          status: string;
          createdAt: string;
          file: string;
          encrypted: boolean;
          exitCode: number;
        },
      };
    } catch {
      return { ok: true, data: null };
    }
  }

  async backupJobs() {
    const jobs = await this.prisma.backupJob.findMany({
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
    return { ok: true, data: jobs };
  }

  async runBackup(userId?: string) {
    const staleBefore = new Date(Date.now() - 6 * 60 * 60 * 1000);
    await this.prisma.backupJob.updateMany({
      where: { status: 'running', startedAt: { lt: staleBefore } },
      data: { status: 'failed', error: 'اجرای قبلی بدون نتیجه متوقف شد', finishedAt: new Date() },
    });
    const running = await this.prisma.backupJob.findFirst({ where: { status: 'running' } });
    if (running) throw new ConflictException('یک پشتیبان‌گیری در حال اجرا است');
    const job = await this.prisma.backupJob.create({
      data: { kind: 'database', status: 'running', startedAt: new Date() },
    });
    if (userId)
      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'create',
          entityType: 'backup_job',
          after: { jobId: String(job.id), status: 'running' },
        },
      });
    void this.executeBackup(job.id).catch(() => undefined);
    return { ok: true, data: { jobId: String(job.id), status: 'running' } };
  }

  private async executeBackup(jobId: bigint) {
    const script =
      process.env.BACKUP_SCRIPT ??
      join(process.env.APP_DIR ?? process.cwd(), 'scripts', 'backup.sh');
    let stderr = '';
    try {
      const exitCode = await new Promise<number>((resolve, reject) => {
        const child = spawn(script, [], {
          cwd: process.env.APP_DIR ?? process.cwd(),
          env: process.env,
          stdio: ['ignore', 'ignore', 'pipe'],
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr = `${stderr}${chunk.toString()}`.slice(-500);
        });
        child.once('error', reject);
        child.once('close', (code) => resolve(code ?? 1));
      });
      const statusResult = await this.backupStatus();
      const backup = statusResult.data;
      const succeeded = exitCode === 0 && backup?.status === 'success';
      let sizeBytes = 0n;
      if (succeeded && backup?.file) {
        try {
          sizeBytes = BigInt(
            (await stat(join(process.env.BACKUP_DIR ?? '/var/backups/salimvand', backup.file)))
              .size,
          );
        } catch {
          sizeBytes = 0n;
        }
      }
      await this.prisma.backupJob.update({
        where: { id: jobId },
        data: {
          status: succeeded ? 'success' : 'failed',
          file: backup?.file || null,
          encrypted: backup?.encrypted ?? true,
          sizeBytes,
          destination: 'local',
          error: succeeded
            ? null
            : stderr.trim() || `فرآیند پشتیبان‌گیری با کد ${exitCode} متوقف شد`,
          finishedAt: new Date(),
        },
      });
    } catch (error) {
      await this.prisma.backupJob.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          error:
            error instanceof Error ? error.message.slice(0, 500) : 'اجرای پشتیبان‌گیری ناموفق بود',
          finishedAt: new Date(),
        },
      });
    }
  }

  async update(values: Record<string, unknown>, userId: string, ip?: string) {
    const entries = Object.entries(values);
    if (!entries.length) throw new BadRequestException('حداقل یک تنظیم لازم است');
    const invalid = entries.find(([key]) => !allowedKeys.has(key));
    if (invalid) throw new BadRequestException(`کلید تنظیمات مجاز نیست: ${invalid[0]}`);
    const before = await this.prisma.setting.findMany({
      where: { key: { in: entries.map(([key]) => key) } },
    });
    const result = await this.prisma.$transaction(async (tx) => {
      for (const [key, value] of entries) {
        await tx.setting.upsert({
          where: { key },
          update: { value: value as Prisma.InputJsonValue, updatedById: userId },
          create: { key, value: value as Prisma.InputJsonValue, updatedById: userId },
        });
      }
      await writeAudit(tx, {
        userId,
        ip,
        action: 'update',
        entityType: 'settings',
        after: values,
        before: Object.fromEntries(before.map((row) => [row.key, row.value])),
      });
      return tx.setting.findMany({ where: { key: { in: entries.map(([key]) => key) } } });
    });
    return { ok: true, data: Object.fromEntries(result.map((row) => [row.key, row.value])) };
  }
}
