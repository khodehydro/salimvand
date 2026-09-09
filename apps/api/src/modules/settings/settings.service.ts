import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { writeAudit } from '../../common/audit/audit-log';
import {
  MESSAGING_SETTINGS_KEY,
  maskMessagingSecrets,
  mergeMessagingSecrets,
} from '../notifications/messaging-config';

const allowedKeys = new Set([
  'store.profile',
  'store.pricing',
  'store.trust_video',
  'sms.templates',
  'integrations.telegram',
  'integrations.bale',
  MESSAGING_SETTINGS_KEY,
  'inventory.default_min_stock',
  'backup.schedule',
]);

/** Keeps raw messaging secrets out of responses and the audit trail. */
function sanitizeSettingsPayload(values: Record<string, unknown>): Record<string, unknown> {
  if (!(MESSAGING_SETTINGS_KEY in values)) return values;
  return {
    ...values,
    [MESSAGING_SETTINGS_KEY]: maskMessagingSecrets(values[MESSAGING_SETTINGS_KEY]),
  };
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const rows = await this.prisma.setting.findMany({ orderBy: { key: 'asc' } });
    return {
      ok: true,
      data: Object.fromEntries(
        rows.map((row) => [
          row.key,
          row.key === MESSAGING_SETTINGS_KEY ? maskMessagingSecrets(row.value) : row.value,
        ]),
      ),
    };
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

  async openBackupDownload() {
    const status = (await this.backupStatus()).data;
    if (!status || status.status !== 'success' || !status.file)
      throw new BadRequestException('فایل پشتیبان آمادهٔ دانلود نیست');
    const root = process.env.BACKUP_DIR ?? '/var/backups/salimvand';
    const file = join(root, status.file);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) throw new BadRequestException('فایل پشتیبان دیگر وجود ندارد');
    const stream = createReadStream(file);
    const remove = () => {
      void unlink(file).catch(() => undefined);
      void unlink(`${file}.manifest`).catch(() => undefined);
    };
    stream.once('close', remove);
    // Never leave a completed archive on the server when the user abandons the dialog.
    const expiry = setTimeout(remove, 10 * 60 * 1000);
    expiry.unref?.();
    return { stream, filename: status.file, size: info.size };
  }

  async update(values: Record<string, unknown>, userId: string, ip?: string) {
    const entries = Object.entries(values);
    if (!entries.length) throw new BadRequestException('حداقل یک تنظیم لازم است');
    const invalid = entries.find(([key]) => !allowedKeys.has(key));
    if (invalid) throw new BadRequestException(`کلید تنظیمات مجاز نیست: ${invalid[0]}`);
    const before = await this.prisma.setting.findMany({
      where: { key: { in: entries.map(([key]) => key) } },
    });
    // Masked secrets round-trip through the panel unchanged; merge them with
    // the stored values so a plain «save» never wipes a credential.
    const merged: Record<string, unknown> = { ...values };
    if (MESSAGING_SETTINGS_KEY in merged) {
      const existing = before.find((row) => row.key === MESSAGING_SETTINGS_KEY)?.value;
      merged[MESSAGING_SETTINGS_KEY] = mergeMessagingSecrets(
        merged[MESSAGING_SETTINGS_KEY],
        existing,
      );
    }
    const result = await this.prisma.$transaction(async (tx) => {
      for (const [key, value] of Object.entries(merged)) {
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
        after: sanitizeSettingsPayload(merged),
        before: sanitizeSettingsPayload(
          Object.fromEntries(before.map((row) => [row.key, row.value])),
        ),
      });
      return tx.setting.findMany({ where: { key: { in: Object.keys(merged) } } });
    });
    return {
      ok: true,
      data: Object.fromEntries(
        result.map((row) => [
          row.key,
          row.key === MESSAGING_SETTINGS_KEY ? maskMessagingSecrets(row.value) : row.value,
        ]),
      ),
    };
  }
}
