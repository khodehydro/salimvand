#!/usr/bin/env node
/**
 * One-time backfill for product thumbnail variants.
 *
 * The media service generates BOTH large.webp (900px) and small.webp (400px)
 * for every new upload, but images uploaded before that behavior existed
 * only have large.webp on disk — productThumbUrl then points at a 404 and
 * clients fall back to the heavy image. This script walks every product
 * image directory, finds the ones that have large.webp but no small.webp,
 * and generates the missing 400px variant from the existing large.webp
 * (same resize/quality the media service uses). Safe to re-run: already
 * complete directories are skipped.
 *
 * Usage (on the server, after a deploy):
 *   node scripts/backfill-product-thumbs.js            # generate
 *   node scripts/backfill-product-thumbs.js --dry-run  # report only
 * Environment:
 *   UPLOAD_DIR  products upload root (same variable the API uses);
 *               defaults to $APP_DIR/uploads/products, then
 *               /opt/salimvand/uploads/products, then <repo>/uploads/products.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// sharp is a dependency of apps/api; resolve it from there (the script itself
// lives in scripts/, outside any package with sharp in its deps).
function loadSharp() {
  const bases = [__dirname, path.join(__dirname, '..', 'apps', 'api'), process.cwd()];
  for (const base of bases) {
    try {
      return require(require.resolve('sharp', { paths: [base] }));
    } catch {
      // try the next location
    }
  }
  console.error('sharp پیدا نشد — اسکریپت را از ریشهٔ ریپو با node_modules نصب‌شده اجرا کنید.');
  process.exit(1);
}

function uploadsRoot() {
  const candidates = [
    process.env.UPLOAD_DIR,
    process.env.APP_DIR && path.join(process.env.APP_DIR, 'uploads', 'products'),
    '/opt/salimvand/uploads/products',
    path.join(__dirname, '..', 'uploads', 'products'),
  ].filter(Boolean);
  for (const candidate of candidates) if (fs.existsSync(candidate)) return path.resolve(candidate);
  console.error(
    `پوشهٔ آپلود محصولات پیدا نشد. مسیرهای بررسی‌شده:\n  ${candidates.join('\n  ')}\n` +
      'UPLOAD_DIR یا APP_DIR را ست کنید.',
  );
  process.exit(1);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const sharp = loadSharp();
  const root = uploadsRoot();
  const entries = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  let generated = 0;
  let skipped = 0;
  const failures = [];
  for (const entry of entries) {
    const large = path.join(root, entry.name, 'large.webp');
    const small = path.join(root, entry.name, 'small.webp');
    if (!fs.existsSync(large)) continue; // legacy/odd layout: nothing to derive from
    if (fs.existsSync(small)) {
      skipped += 1;
      continue;
    }
    if (dryRun) {
      console.log(`[dry-run] small.webp می‌سازد برای ${entry.name}`);
      continue;
    }
    try {
      // Same parameters as MediaService.upload's small variant; large.webp is
      // already rotated, so only the resize + webp encode is repeated here.
      await sharp(large)
        .resize({ width: 400, withoutEnlargement: true })
        .webp({ quality: 78 })
        .toFile(small);
      // Preserve the owner of the sibling large.webp (root runs the deploy;
      // the API service user must keep read access to new files too).
      try {
        const stats = fs.statSync(large);
        fs.chownSync(small, stats.uid, stats.gid);
      } catch {
        // chown needs root — without it the file simply keeps this script's owner.
      }
      generated += 1;
      console.log(`small.webp ساخته شد: ${entry.name}`);
    } catch (error) {
      failures.push(entry.name);
      console.error(`خطا در ${entry.name}: ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log(
    `\nخلاصه: ${entries.length} دایرکتوری، ${generated} ساخته شد، ${skipped} از قبل کامل` +
      (dryRun ? ' (dry-run — چیزی نوشته نشد)' : '') +
      (failures.length ? `، ${failures.length} خطا: ${failures.join('، ')}` : '') +
      '.',
  );
  if (failures.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
