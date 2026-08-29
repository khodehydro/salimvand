import { BadRequestException, Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { writeAudit } from '../../common/audit/audit-log';

const allowedKeys = new Set(['store.profile', 'store.trust_video', 'sms.templates', 'integrations.telegram', 'integrations.bale', 'inventory.default_min_stock', 'backup.schedule']);

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const rows = await this.prisma.setting.findMany({ orderBy: { key: 'asc' } });
    return { ok: true, data: Object.fromEntries(rows.map((row) => [row.key, row.value])) };
  }

  async backupStatus() {
    try {
      const raw = await readFile(process.env.BACKUP_STATUS_FILE ?? '/var/lib/salimvand/backup-status.json', 'utf8');
      return { ok: true, data: JSON.parse(raw) as { status: string; createdAt: string; file: string; encrypted: boolean; exitCode: number } };
    } catch { return { ok: true, data: null }; }
  }

  async backupJobs() {
    const jobs = await this.prisma.backupJob.findMany({
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
    return { ok: true, data: jobs };
  }

  async runBackup(userId?: string) {
    const job = await this.prisma.backupJob.create({
      data: {
        kind: 'database',
        status: 'running',
        startedAt: new Date(),
      },
    });
    return { ok: true, data: { jobId: String(job.id), status: 'running' } };
  }

  async update(values: Record<string, unknown>, userId: string, ip?: string) {
    const entries = Object.entries(values);
    if (!entries.length) throw new BadRequestException('حداقل یک تنظیم لازم است');
    const invalid = entries.find(([key]) => !allowedKeys.has(key));
    if (invalid) throw new BadRequestException(`کلید تنظیمات مجاز نیست: ${invalid[0]}`);
    const before = await this.prisma.setting.findMany({ where: { key: { in: entries.map(([key]) => key) } } });
    const result = await this.prisma.$transaction(async (tx) => {
      for (const [key, value] of entries) {
        await tx.setting.upsert({ where: { key }, update: { value: value as Prisma.InputJsonValue, updatedById: userId }, create: { key, value: value as Prisma.InputJsonValue, updatedById: userId } });
      }
      await writeAudit(tx, { userId, ip, action: 'update', entityType: 'settings', after: values, before: Object.fromEntries(before.map((row) => [row.key, row.value])) });
      return tx.setting.findMany({ where: { key: { in: entries.map(([key]) => key) } } });
    });
    return { ok: true, data: Object.fromEntries(result.map((row) => [row.key, row.value])) };
  }
}
