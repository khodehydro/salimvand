import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const script = resolve(process.cwd(), '../../scripts/configure-slider-upload.py');
const configure = (raw: string) =>
  execFileSync(
    'python3',
    [
      '-c',
      'import runpy,sys; m=runpy.run_path(sys.argv[1]); sys.stdout.write(m["configure"](sys.stdin.read()))',
      script,
    ],
    { input: raw, encoding: 'utf8' },
  );
describe('slider upload deployment', () => {
  it('raises only the API location while preserving listeners, TLS and other body limits', () => {
    const raw =
      'server { listen 443 ssl; server_name cms.salimvand.ir; ssl_certificate /cert; location /api/ { proxy_pass http://salimvand_api; } location / { client_max_body_size 1m; } }';
    const patched = configure(raw);
    expect(patched).toContain('client_max_body_size 6m;');
    expect(patched).toContain('location / { client_max_body_size 1m; }');
    expect(patched).toContain('listen 443 ssl;');
    expect(patched).toContain('ssl_certificate /cert;');
    expect(configure(patched)).toBe(patched);
  });
  it.each(['0', '20m', '8M', '1g'])(
    'does not lower an existing larger/unlimited body size %s',
    (size) => {
      const raw = `location /api/ { client_max_body_size ${size}; proxy_pass http://api; }`;
      expect(configure(raw)).toBe(raw);
    },
  );
  it('does not mistake a commented-out limit for a real directive', () => {
    const raw = 'location /api/ {\n # client_max_body_size 20m;\n proxy_pass http://api;\n}';
    expect(configure(raw)).toContain('\n        client_max_body_size 6m;');
    expect(configure(raw)).toContain('# client_max_body_size 20m;');
  });
  it('replaces a smaller limit instead of duplicating its directive', () => {
    const patched = configure(
      'location /api/ { client_max_body_size 1024k; proxy_pass http://api; }',
    );
    expect(patched.match(/client_max_body_size/g)).toHaveLength(1);
    expect(patched).toContain('6m;');
  });
  it('patches the live vhost inside the existing backup/test/rollback guard', () => {
    const deploy = readFileSync(resolve(process.cwd(), '../../scripts/deploy.sh'), 'utf8');
    expect(deploy).toContain('configure-slider-upload.py" "$NGINX_CONF" || rollback_vhost');
    expect(deploy.indexOf('VHOST_BACKUP=')).toBeLessThan(
      deploy.indexOf('configure-slider-upload.py'),
    );
    expect(deploy.indexOf('configure-slider-upload.py')).toBeLessThan(
      deploy.indexOf('nginx -t || rollback_vhost'),
    );
  });
});
