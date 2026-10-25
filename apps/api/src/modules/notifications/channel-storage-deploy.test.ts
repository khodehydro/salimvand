import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const repository = resolve(__dirname, '../../../../..');

describe('production channel storage provisioning', () => {
  it.each([false, true])('deploy provisions the directory (custom uploads: %s)', async (custom) => {
    if (process.platform === 'win32') return;
    const root = await mkdtemp(join(tmpdir(), 'channel-storage-deploy-'));
    try {
      const source = await readFile(join(repository, 'scripts/deploy.sh'), 'utf8');
      const provisioning = source.match(
        /^CHANNEL_PHOTO_DIR=.*\ninstall -d -o salimvand -g salimvand -m 0755 "\$CHANNEL_PHOTO_DIR"$/m,
      )?.[0];
      expect(provisioning).toBeTruthy();
      // Execute the real path/provisioning commands, without chown: tests do
      // not require root or a production salimvand user on the development host.
      const env: NodeJS.ProcessEnv = { ...process.env, ROOT_DIR: root };
      delete env.UPLOAD_DIR;
      const uploadRoot = custom ? join(root, 'custom uploads') : join(root, 'uploads');
      if (custom) env.UPLOAD_DIR = join(uploadRoot, 'products');
      await mkdir(uploadRoot, { recursive: true });
      const dir = join(uploadRoot, 'channel-posts');
      // Repair an existing directory with restrictive permissions as well.
      await mkdir(dir, { mode: 0o500 });
      await execute('bash', ['-c', provisioning!.replace('-o salimvand -g salimvand ', '')], {
        env,
      });
      expect((await stat(dir)).mode & 0o777).toBe(0o755);
      expect(source.indexOf(provisioning!)).toBeLessThan(source.indexOf('systemctl restart'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('bootstrap also provisions the channel directory for the service user', async () => {
    const source = await readFile(join(repository, 'scripts/setup-server.sh'), 'utf8');
    expect(source).toContain(
      'install -d -o salimvand -g salimvand -m 0755 "$APP_DIR/uploads/channel-posts"',
    );
  });
});
