import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { APP_NAME, API_PREFIX } from '@salimvand/shared';
import { NotificationsService } from './modules/notifications/notifications.service';
import { PrismaService } from './prisma.service';

/** Release stamp written by scripts/deploy.sh (version.json beside the app).
 * Read once per process — the API restarts on every deploy, so it stays in
 * sync with what is actually running. */
let releaseCache: { commit: string; builtAt: string } | null | undefined;

async function readRelease(): Promise<{ commit: string; builtAt: string } | null> {
  if (releaseCache !== undefined) return releaseCache;
  try {
    const file = join(process.env.APP_DIR ?? process.cwd(), 'version.json');
    releaseCache = JSON.parse(await readFile(file, 'utf-8')) as {
      commit: string;
      builtAt: string;
    };
  } catch {
    releaseCache = null;
  }
  return releaseCache;
}

@Controller()
export class SystemController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get('health')
  async health() {
    const release = await readRelease();
    return {
      ok: true,
      data: {
        service: 'api',
        name: APP_NAME,
        prefix: API_PREFIX,
        database: 'configured',
        release: release?.commit?.slice(0, 7) ?? 'dev',
        builtAt: release?.builtAt ?? null,
      },
    };
  }

  @Get('health/ready')
  async readiness() {
    // The database is mandatory; the notification queue is best-effort and must
    // not block the release when Redis is temporarily unavailable.
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('پایگاه داده در دسترس نیست');
    }
    let queue = 'ready';
    try {
      await this.notifications.checkQueueConnection();
    } catch (err) {
      queue = 'degraded';
      console.warn('[health] notification queue unavailable:', (err as Error)?.message ?? err);
    }
    return { ok: true, data: { service: 'api', database: 'ready', queue } };
  }
}
