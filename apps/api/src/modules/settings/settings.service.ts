import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { execFile, spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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

  async inspectBackup(file: { buffer: Buffer; originalname: string }) {
    if (file.buffer.length > 2 * 1024 * 1024 * 1024) throw new BadRequestException('حجم فایل Backup بیش از حد مجاز است');
    const dir = await mkdtemp(join(tmpdir(), 'salimvand-import-'));
    const input = join(dir, file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'));
    try {
      await writeFile(input, file.buffer, { mode: 0o600 });
      let archive = input;
      if (input.endsWith('.gpg')) {
        if (!process.env.BACKUP_ENCRYPTION_KEY) throw new BadRequestException('کلید رمزگشایی Backup تنظیم نشده است');
        archive = join(dir, 'backup.tar.gz');
        await new Promise<void>((resolve, reject) => {
          const child = spawn('gpg', ['--batch', '--quiet', '--decrypt', '--passphrase', process.env.BACKUP_ENCRYPTION_KEY!, '--output', archive, input]);
          child.once('error', reject); child.once('close', (code) => code === 0 ? resolve() : reject(new Error('رمزگشایی Backup ناموفق بود')));
        });
      }
      const listing = await new Promise<string>((resolve, reject) => execFile('tar', ['-tzf', archive], { maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => error ? reject(new Error('آرشیو Backup معتبر نیست')) : resolve(stdout)));
      const entries = listing.split('\\n').filter(Boolean);
      if (entries.some((entry) => entry.startsWith('/') || entry.split('/').includes('..'))) throw new BadRequestException('مسیر ناامن داخل Backup شناسایی شد');
      if (!entries.includes('database/postgres.sql.gz') || !entries.includes('metadata/manifest.json')) throw new BadRequestException('ساختار Backup کامل نیست');
      const manifest = await new Promise<string>((resolve, reject) => execFile('tar', ['-xOf', archive, 'metadata/manifest.json'], { maxBuffer: 64 * 1024 }, (error, stdout) => error ? reject(new Error('Manifest یافت نشد')) : resolve(stdout)));
      const metadata = JSON.parse(manifest) as { version?: number; createdAt?: string; mediaIncluded?: boolean };
      return { ok: true, data: { valid: true, filename: file.originalname, sizeBytes: file.buffer.length, entries: entries.length, version: metadata.version ?? null, createdAt: metadata.createdAt ?? null, mediaIncluded: metadata.mediaIncluded === true } };
    } catch (error) { if (error instanceof BadRequestException) throw error; throw new BadRequestException(error instanceof Error ? error.message : 'بررسی Backup ناموفق بود'); }
    finally { await rm(dir, { recursive: true, force: true }); }
  }

  async uploadBackupToDrive() {
    const status = (await this.backupStatus()).data;
    if (!status || status.status !== 'success' || !status.file) throw new BadRequestException('فایل پشتیبان آماده نیست');
    const root = process.env.BACKUP_DIR ?? '/var/backups/salimvand';
    const file = join(root, status.file);
    const bytes = await readFile(file).catch(() => null);
    if (!bytes) throw new BadRequestException('فایل پشتیبان یافت نشد');
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) throw new BadRequestException('پوشهٔ مقصد Google Drive تنظیم نشده است');
    let accessToken = process.env.GOOGLE_DRIVE_ACCESS_TOKEN;
    if (!accessToken && process.env.GOOGLE_DRIVE_REFRESH_TOKEN && process.env.GOOGLE_DRIVE_CLIENT_ID && process.env.GOOGLE_DRIVE_CLIENT_SECRET) {
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: process.env.GOOGLE_DRIVE_CLIENT_ID, client_secret: process.env.GOOGLE_DRIVE_CLIENT_SECRET, refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN, grant_type: 'refresh_token' }),
      });
      if (tokenResponse.ok) accessToken = (await tokenResponse.json() as { access_token?: string }).access_token;
    }
    if (!accessToken) throw new BadRequestException('اتصال Google Drive روی سرور تنظیم نشده است');
    const metadata = { name: status.file, parents: [folderId], description: 'Salimvand full backup' };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([bytes], { type: 'application/octet-stream' }), status.file);
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form,
    });
    if (!response.ok) throw new BadRequestException('ارسال Backup به Google Drive ناموفق بود');
    const result = (await response.json()) as { id?: string; name?: string; webViewLink?: string };
    await unlink(file).catch(() => undefined); await unlink(`${file}.manifest`).catch(() => undefined);
    return { ok: true, data: { id: result.id, name: result.name, webViewLink: result.webViewLink ?? `https://drive.google.com/open?id=${result.id}` } };
  }

  async restoreBackup(file: { buffer: Buffer; originalname: string }, requestedBy?: string) {
    if (process.env.BACKUP_RESTORE_ENABLED !== 'true') throw new BadRequestException('Restore از پنل روی این سرور فعال نشده است');
    const targetDatabase = process.env.BACKUP_RESTORE_TARGET_DATABASE_URL;
    if (!targetDatabase) throw new BadRequestException('دیتابیس مقصد Restore تنظیم نشده است');
    const dir = await mkdtemp(join(tmpdir(), 'salimvand-restore-job-'));
    const input = join(dir, file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'));
    try {
      await writeFile(input, file.buffer, { mode: 0o600 });
      const script = process.env.RESTORE_SCRIPT ?? join(process.env.APP_DIR ?? process.cwd(), 'scripts', 'restore.sh');
      const output = await new Promise<string>((resolve, reject) => {
        let stderr = '';
        const child = spawn(script, [input], { cwd: process.env.APP_DIR ?? process.cwd(), env: { ...process.env, CONFIRM_RESTORE: 'RESTORE_TO_TARGET', TARGET_DATABASE_URL: targetDatabase, RESTORE_MEDIA: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
        child.stdout.on('data', (chunk: Buffer) => { /* do not expose database output */ void chunk; });
        child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-500); });
        child.once('error', reject); child.once('close', (code) => code === 0 ? resolve('completed') : reject(new Error(stderr || `Restore با کد ${code} متوقف شد`)));
      });
      // A restored database may contain old sessions; revoke them all before reopening access.
      await this.prisma.refreshToken.updateMany({ where: { revokedAt: null }, data: { revokedAt: new Date() } });
      if (requestedBy) {
        const restoredUser = await this.prisma.user.findUnique({ where: { id: requestedBy }, select: { id: true } }).catch(() => null);
        if (restoredUser) await this.prisma.auditLog.create({ data: { userId: requestedBy, action: 'restore', entityType: 'backup', after: { filename: file.originalname, status: 'completed' } } });
      }
      return { ok: true, data: { status: output } };
    } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Restore ناموفق بود'); }
    finally { await rm(dir, { recursive: true, force: true }); }
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
