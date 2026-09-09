import { execFile } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execute = promisify(execFile);

describe('production backup script', () => {
  it('writes a verifiable manifest and ISO status document', async () => {
    const root = await mkdtemp(join(tmpdir(), 'salimvand-backup-test-'));
    const appDir = join(root, 'app');
    const backupDir = join(root, 'backups');
    const binDir = join(root, 'bin');
    await Promise.all([mkdir(appDir), mkdir(backupDir), mkdir(binDir)]);
    await writeFile(
      join(appDir, '.env'),
      'DATABASE_URL=postgresql://test\nBACKUP_ENCRYPTION_KEY=\n',
    );
    const pgDump = join(binDir, 'pg_dump');
    await writeFile(
      pgDump,
      '#!/usr/bin/env bash\nprintf -- "-- deterministic test dump\\nSELECT 1;\\n"\n',
    );
    await chmod(pgDump, 0o755);
    const statusFile = join(root, 'status.json');
    const script = resolve(process.cwd(), '../../scripts/backup.sh');
    await execute(script, [], {
      env: {
        ...process.env,
        APP_DIR: appDir,
        BACKUP_DIR: backupDir,
        BACKUP_STATUS_FILE: statusFile,
        PATH: `${binDir}:${process.env.PATH}`,
      },
    });

    const files = (await import('node:fs/promises')).readdir(backupDir);
    const archive = (await files).find((file) => file.endsWith('.tar.gz'));
    expect(archive).toBeTruthy();
    const manifest = await readFile(join(backupDir, `${archive}.manifest`), 'utf8');
    expect(manifest.split('\n')).toEqual(
      expect.arrayContaining(['version=2', `file=${archive}`, 'encrypted=false', 'format=full-archive']),
    );
    expect(manifest).not.toContain('\\n');
    await execute(resolve(process.cwd(), '../../scripts/verify-backup.sh'), [
      join(backupDir, archive!),
    ]);
    const status = JSON.parse(await readFile(statusFile, 'utf8')) as {
      status: string;
      createdAt: string;
      file: string;
      progress: number;
      phase: string;
    };
    expect(status).toMatchObject({ status: 'success', progress: 100, phase: 'پشتیبان‌گیری کامل شد', file: archive });
    expect(Number.isNaN(Date.parse(status.createdAt))).toBe(false);
  });
});
