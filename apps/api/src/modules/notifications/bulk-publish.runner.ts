import type { SocialPlatform, PublishChannelResult } from './social-publisher.service';
import type { BulkPublishFilterDto } from './bulk-publish.dto';

export const BULK_BATCH_SIZE = 10;
export const BULK_BATCH_DELAY_MS = 30_000;
export const BULK_PRODUCT_DELAY_MS = 1_500;
export type BulkIssue = {
  productId: string;
  code: string;
  platform: SocialPlatform;
  reason: string;
};
export type BulkProgress = {
  status: 'queued' | 'running' | 'waiting' | 'completed' | 'cancelled';
  cursor: number;
  sent: Record<SocialPlatform, number>;
  failed: Record<SocialPlatform, number>;
  skipped: Record<SocialPlatform, number>;
  doneChannels: SocialPlatform[];
  inFlight?: SocialPlatform;
  nextBatchAt?: number;
  issues: BulkIssue[];
};
export type BulkData = {
  filters: BulkPublishFilterDto;
  products: Array<{ id: string; code: string }>;
  platforms: SocialPlatform[];
  progress: BulkProgress;
};
export function initialBulkProgress(): BulkProgress {
  return {
    status: 'queued',
    cursor: 0,
    sent: { telegram: 0, bale: 0 },
    failed: { telegram: 0, bale: 0 },
    skipped: { telegram: 0, bale: 0 },
    doneChannels: [],
    issues: [],
  };
}
export type BulkRunnerDeps = {
  publish: (id: string, platform: SocialPlatform) => Promise<PublishChannelResult>;
  eligible: (id: string) => Promise<boolean>;
  cancelled: () => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

/** Each side-effect has a durable 'inFlight' checkpoint. After a worker crash,
 * an ambiguous delivery is reported for manual review, NEVER auto-republished.
 * This is deliberately at-most-once for ambiguous attempts: bot APIs do not
 * offer idempotency keys and retrying could duplicate an already-delivered post. */
export async function runBulkPublish(
  job: { data: BulkData; updateData: (data: BulkData) => Promise<void> },
  deps: BulkRunnerDeps,
): Promise<void> {
  const data = structuredClone(job.data);
  const p = data.progress;
  const save = () => job.updateData(data);
  const issue = (platform: SocialPlatform, reason: string) => {
    p.issues.push({
      productId: data.products[p.cursor].id,
      code: data.products[p.cursor].code,
      platform,
      reason: reason.slice(0, 300),
    });
    p.issues = p.issues.slice(-100);
  };
  const cancel = async () => {
    if (!(await deps.cancelled())) return false;
    p.status = 'cancelled';
    delete p.nextBatchAt;
    await save();
    return true;
  };
  if (p.status === 'completed' || p.status === 'cancelled') return;
  if (p.inFlight && p.cursor < data.products.length) {
    const platform = p.inFlight;
    p.failed[platform]++;
    p.doneChannels.push(platform);
    issue(
      platform,
      'وضعیت ارسال هنگام توقف worker نامشخص شد؛ برای جلوگیری از پست تکراری خودکار تکرار نشد',
    );
    delete p.inFlight;
    await save();
  }
  while (p.cursor < data.products.length) {
    if (await cancel()) return;
    if (p.nextBatchAt) {
      p.status = 'waiting';
      await save();
      while (deps.now() < p.nextBatchAt) {
        if (await cancel()) return;
        await deps.sleep(Math.min(5_000, p.nextBatchAt - deps.now()));
      }
      delete p.nextBatchAt;
    }
    p.status = 'running';
    const product = data.products[p.cursor];
    const eligible = await deps.eligible(product.id);
    for (const platform of data.platforms) {
      if (p.doneChannels.includes(platform)) continue;
      if (await cancel()) return;
      if (!eligible) {
        p.skipped[platform]++;
        issue(platform, 'محصول حذف یا غیرفعال شده است');
      } else {
        p.inFlight = platform;
        await save(); // No provider call is allowed before this write succeeds.
        let result: PublishChannelResult;
        try {
          result = await deps.publish(product.id, platform);
        } catch {
          result = {
            ok: false,
            reason: 'انتشار انجام نشد؛ وضعیت محصول و تنظیمات کانال را بررسی کنید',
          };
        }
        if (result.ok) p.sent[platform]++;
        else if (result.skipped) p.skipped[platform]++;
        else p.failed[platform]++;
        if (!result.ok) issue(platform, result.reason || 'انتشار ناموفق');
        delete p.inFlight;
      }
      p.doneChannels.push(platform);
      await save();
    }
    p.cursor++;
    p.doneChannels = [];
    if (p.cursor < data.products.length && p.cursor % BULK_BATCH_SIZE === 0) {
      p.nextBatchAt = deps.now() + BULK_BATCH_DELAY_MS;
      p.status = 'waiting';
    }
    await save();
    if (p.cursor < data.products.length && !p.nextBatchAt) await deps.sleep(BULK_PRODUCT_DELAY_MS);
  }
  p.status = 'completed';
  await save();
}
