import { PrismaClient, UserRole } from '@prisma/client';
import argon2 from 'argon2';
import { createEan13 } from '@salimvand/shared';

const prisma = new PrismaClient();

/**
 * A realistic, idempotent seed: reference data (categories, brands, vehicles,
 * locations), a set of catalog products each with a per-brand inventory item
 * (with EAN-13 barcode, shelf and stock levels that produce in/low/out states),
 * vehicle compatibility, and the initial admin user.
 *
 * Runs safely on repeat: everything uses upsert on a true unique key, and the
 * ProductVehicleCompat relation (whose unique key is nullable/compound) is
 * rebuilt with deleteMany + create instead of a nullable compound upsert.
 */
async function main() {
  const categories = await seedCategories();
  const brands = await seedBrands();
  const makes = await seedVehicles();
  const locations = await seedLocations();
  await seedSettings();

  // name | categoryKey | brand | qty | min | price(rial) | shelfPrefix
  const items: Array<[string, string, string, number, number, number, string]> = [
    ['لنت ترمز پژو ۲۰۶', 'brake', 'سلیم وند', 12, 4, 1_850_000, 'A'],
    ['لنت ترمز پژو ۲۰۶', 'brake', 'ایساکو', 2, 4, 1_650_000, 'A'],
    ['لنت ترمز پژو ۲۰۶', 'brake', 'مهر', 0, 3, 1_420_000, 'B'],
    ['دیسک ترمز پژو ۲۰۶', 'brake', 'سلیم وند', 7, 2, 3_400_000, 'B'],
    ['فیلتر روغن پژو ۲۰۶', 'filter', 'سلیم وند', 25, 10, 240_000, 'C'],
    ['فیلتر روغن پژو ۴۰۵', 'filter', 'ایساکو', 6, 10, 210_000, 'C'],
    ['تسمه تایم سمند', 'belt', 'سلیم وند', 4, 2, 780_000, 'D'],
    ['شمع پژو ۲۰۶ (سفید)', 'engine', 'بوش', 16, 8, 520_000, 'E'],
    ['شمع پژو ۲۰۶ (طلایی)', 'engine', 'سلیم وند', 0, 8, 690_000, 'E'],
    ['چراغ جلو پژو ۴۰۵', 'light', 'سلیم وند', 3, 1, 1_100_000, 'F'],
  ];

  const perCategory = new Map<string, number>();
  for (const [name, catKey, brandName, qty, min, price, shelf] of items) {
    const category = categories[catKey];
    const brand = brands[brandName];
    const location = locations[shelf];
    if (!category || !brand) continue;

    const prefix = catPrefix(catKey);
    const index = (perCategory.get(prefix) ?? 0) + 1;
    perCategory.set(prefix, index);
    const code = `${prefix}-${String(index).padStart(5, '0')}`;

    const product = await prisma.product.upsert({
      where: { code },
      update: {},
      create: {
        code,
        name,
        slug: createSlug(`${name} ${index}`),
        categoryId: category.id,
        description: `قطعه یدکی ${name} با تضمین اصالت کالا — استعلام قیمت روز از فروشگاه سلیم وند میاندوآب.`,
        partNumber: code,
        status: 'active',
        inventoryItems: {
          create: [
            {
              brandId: brand.id,
              quantity: qty,
              minStock: min,
              purchasePrice: price,
              salePrice: price + Math.round(price * 0.18),
              locationId: location?.id ?? null,
              barcode: createEan13(code),
            },
          ],
        },
      },
    });

    const model = matchModel(name, makes);
    if (model) {
      await prisma.productVehicleCompat.deleteMany({
        where: { productId: product.id, modelId: model.id },
      });
      await prisma.productVehicleCompat.create({
        data: { productId: product.id, modelId: model.id },
      });
    }
  }

  await prisma.counter.upsert({
    where: { key: 'product' },
    update: {
      lastValue: Math.max(
        1,
        [...perCategory.values()].reduce((a, b) => a + b, 0),
      ),
    },
    create: {
      key: 'product',
      lastValue: Math.max(
        1,
        [...perCategory.values()].reduce((a, b) => a + b, 0),
      ),
    },
  });

  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (adminPassword) {
    const passwordHash = await argon2.hash(adminPassword, { type: argon2.argon2id });
    await prisma.user.upsert({
      where: { username: process.env.SEED_ADMIN_USERNAME ?? 'admin' },
      update: { passwordHash, role: UserRole.super_admin, isActive: true },
      create: {
        name: process.env.SEED_ADMIN_NAME ?? 'مدیر سیستم',
        username: process.env.SEED_ADMIN_USERNAME ?? 'admin',
        passwordHash,
        role: UserRole.super_admin,
        isActive: true,
      },
    });
    console.log('Seeded the initial admin user.');
  } else {
    console.log(
      'Seeded references and catalog data; SEED_ADMIN_PASSWORD was not set, so no admin was created.',
    );
  }
}

/**
 * Default store settings so the admin panel starts with the same values the
 * public site renders (phones, address, hours, map, social links, SMS
 * templates). Existing values are never overwritten — operators own them.
 */
async function seedSettings() {
  const defaults: Array<{ key: string; value: unknown }> = [
    {
      key: 'store.profile',
      value: {
        name: 'فروشگاه سلیم وند',
        phones: '۰۴۱-۳۲۳۴۵۶۷۸, ۰۹۱۴۱۲۳۴۵۶۷',
        address: 'میاندوآب، خیابان امام، بازار قطعات خودرو، پلاک ۱۲',
        open: '09:00',
        close: '20:00',
        mapUrl: '',
        mapCode: '',
        instagram: '',
      },
    },
    { key: 'store.trust_video', value: '' },
    {
      key: 'sms.templates',
      value: {
        invoice:
          '{customer_name}\n\nفاکتور شماره {invoice_number} شما صادر شد\n\nمشاهده:\n{link}\n\nبا تشکر از خرید شما\nفروشگاه سلیم وند',
        autoSend: true,
      },
    },
    { key: 'integrations.telegram', value: { link: '' } },
    { key: 'integrations.bale', value: { link: '' } },
    // Messaging credentials are managed from the panel (پیامک و کانال‌ها ←
    // پیکربندی); the empty shape here only makes the settings row visible.
    { key: 'integrations.messaging', value: {} },
    { key: 'inventory.default_min_stock', value: 3 },
    { key: 'backup.schedule', value: { enabled: true } },
  ];
  for (const entry of defaults) {
    await prisma.setting.upsert({
      where: { key: entry.key },
      update: {},
      create: { key: entry.key, value: entry.value as never },
    });
  }
  console.log('Seeded default store settings (existing values kept).');
}

function catPrefix(catKey: string): string {
  const map: Record<string, string> = {
    brake: 'BRK',
    filter: 'FLT',
    belt: 'BLT',
    engine: 'ENG',
    light: 'LGT',
  };
  return map[catKey] ?? 'PRD';
}

async function seedCategories() {
  const data: Array<{ key: string; name: string; slug: string; code: string }> = [
    { key: 'brake', name: 'لوازم ترمز', slug: 'lozazem-tormoz', code: 'BRK' },
    { key: 'filter', name: 'فیلترها', slug: 'filterha', code: 'FLT' },
    { key: 'belt', name: 'تسمه و اتصالات', slug: 'tasme-ettesalat', code: 'BLT' },
    { key: 'engine', name: 'موتور', slug: 'motor', code: 'ENG' },
    { key: 'light', name: 'روشنایی', slug: 'roshanayi', code: 'LGT' },
  ];
  const out: Record<string, { id: string }> = {};
  for (const cat of data) {
    const row = await prisma.category.upsert({
      where: { code: cat.code },
      update: {},
      create: { name: cat.name, slug: cat.slug, code: cat.code },
    });
    out[cat.key] = row as unknown as { id: string };
  }
  return out;
}

async function seedBrands() {
  const data = ['سلیم وند', 'ایساکو', 'مهر', 'بوش'];
  const out: Record<string, { id: string }> = {};
  for (const name of data) {
    const row = await prisma.brand.upsert({ where: { name }, update: {}, create: { name } });
    out[name] = row as unknown as { id: string };
  }
  return out;
}

async function seedVehicles() {
  const makes: Array<{ name: string; models: string[] }> = [
    { name: 'ایران خودرو', models: ['پژو ۲۰۶', 'پژو ۴۰۵', 'سمند', 'دنا'] },
    { name: 'سایپا', models: ['پراید ۱۱۱', 'تیبا', 'ساینا'] },
  ];
  const out: Record<string, { model: string; id: string }[]> = {};
  for (const make of makes) {
    const mk = await prisma.vehicleMake.upsert({
      where: { name: make.name },
      update: {},
      create: { name: make.name },
    });
    for (const modelName of make.models) {
      const model = await prisma.vehicleModel.upsert({
        where: { makeId_name: { makeId: mk.id, name: modelName } },
        update: {},
        create: { makeId: mk.id, name: modelName },
      });
      (out[make.name] ??= []).push({ model: modelName, id: model.id });
    }
  }
  return out;
}

async function seedLocations() {
  // Flat shelves keyed by a one-letter prefix so the item table can reference
  // them by prefix (A-1, B-1, ...). Location has no unique on `code` alone, so
  // we look up by (parentId = null, code) and create if missing.
  const shelves = ['A-1', 'A-2', 'B-1', 'B-2', 'C-1', 'D-1', 'E-1', 'F-1'];
  const out: Record<string, { id: string }> = {};
  for (const code of shelves) {
    const existing = await prisma.location.findFirst({ where: { code, parentId: null } });
    const row =
      existing ??
      (await prisma.location.create({ data: { code, name: `قفسه ${code}`, type: 'shelf' } }));
    out[code[0]] = row as unknown as { id: string };
  }
  return out;
}

function matchModel(productName: string, makes: Record<string, { model: string; id: string }[]>) {
  const all = Object.values(makes).flat();
  for (const entry of all) {
    const keyword = entry.model.replace(/پژو /, '').replace(/ \d+/, '');
    if (productName.includes(keyword) || productName.includes(entry.model)) return entry;
  }
  return all[0];
}

function createSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\u200c\s]+/g, '-')
    .replace(/[^\u0600-\u06ff\u0041-\u005a\u0061-\u007a\u0030-\u0039-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

main().finally(() => prisma.$disconnect());
