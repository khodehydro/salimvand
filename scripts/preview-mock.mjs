// Local preview mock for the admin panel — lets the panel run against
// realistic data without a Nest/Postgres stack (pnpm --filter @salimvand/admin
// dev + `node scripts/preview-mock.mjs`). Shapes mirror the real API closely
// enough to exercise the UI: products list/detail/create with atomic items[],
// locations flat+nested, auth, dashboard, analytics, media, settings.
import http from 'node:http';

const uid = (n) => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
let seq = 100;
const nextId = (prefix) => uid(prefix * 1 + ++seq);

const state = {
  user: { id: uid(1), name: 'مدیر پیش‌نمایش', username: 'admin', role: 'super_admin' },
  categories: [
    { id: uid(11), name: 'لنت و ترمز', isActive: true },
    { id: uid(12), name: 'فیلتر', isActive: true },
    { id: uid(13), name: 'موتور', isActive: true },
  ],
  brands: [
    { id: uid(21), name: 'بوش', isActive: true },
    { id: uid(22), name: 'والئو', isActive: true },
  ],
  suppliers: [
    { id: uid(31), name: 'فروشگاه اتوپارت', isActive: true },
    { id: uid(32), name: 'بازرگانی پارس', isActive: true },
  ],
  locations: [
    { id: uid(41), name: 'انبار اصلی', code: '1', type: 'warehouse', parentId: null },
    { id: uid(42), name: 'قفسه ۱.۱', code: '1.1', type: 'shelf', parentId: uid(41) },
    { id: uid(43), name: 'قفسه ۱.۲', code: '1.2', type: 'shelf', parentId: uid(41) },
    { id: uid(44), name: 'سبد الف', code: '1.1-A', type: 'basket', parentId: uid(42) },
  ],
  makes: [
    {
      id: uid(51), name: 'پژو',
      models: [
        { id: uid(52), name: '۲۰۶', trims: [{ id: uid(53), name: 'تیپ ۵' }] },
        { id: uid(54), name: 'پارس', trims: [] },
      ],
    },
  ],
  products: [],
};

let productSeq = 0;
function makeProduct(overrides = {}) {
  productSeq += 1;
  const id = uid(60 + productSeq);
  const brand = state.brands[productSeq % state.brands.length];
  return {
    id,
    name: `لنت جلو ${brand.name} پژو ۲۰۶ ${productSeq}`,
    code: `P-${1000 + productSeq}`,
    slug: `pad-front-206-${productSeq}`,
    categoryId: state.categories[productSeq % state.categories.length].id,
    category: state.categories[productSeq % state.categories.length],
    description: 'توضیح آزمایشی محصول برای پیش‌نمایش',
    partNumber: `PN-${productSeq}`,
    status: 'active',
    priceDisplay: 'inherit',
    salePrice: 1250000,
    aparatVideoId: null,
    seoTitle: null,
    seoDescription: null,
    seoKeywords: ['لنت', 'پژو ۲۰۶'],
    images: [],
    compatibilities: [
      {
        id: uid(70 + productSeq),
        model: { id: uid(52), name: '۲۰۶', make: { id: uid(51), name: 'پژو' } },
        trim: null,
      },
    ],
    inventoryItems: [
      {
        id: uid(80 + productSeq),
        productId: id,
        brandId: brand.id,
        brand,
        supplierId: state.suppliers[0].id,
        supplier: { id: state.suppliers[0].id, name: state.suppliers[0].name },
        barcode: `6001230000${(productSeq % 9) + 1}`,
        quantity: 4 + productSeq,
        purchasePrice: 800000,
        salePrice: 1250000,
        minStock: 2,
        locationId: uid(42),
        location: {
          id: uid(42),
          name: 'قفسه ۱.۱',
          code: '1.1',
          type: 'shelf',
          parent: { name: 'انبار اصلی' },
        },
        basketId: uid(44),
        basket: { id: uid(44), name: 'سبد الف', code: '1.1-A' },
        notes: null,
      },
    ],
    ...overrides,
  };
}
for (let i = 0; i < 7; i += 1) state.products.push(makeProduct());

const locationTree = () => {
  const warehouses = state.locations.filter((l) => l.type === 'warehouse');
  return warehouses.map((w) => ({
    ...w,
    children: state.locations
      .filter((l) => l.parentId === w.id && l.type !== 'basket')
      .map((shelf) => ({
        ...shelf,
        children: state.locations.filter((l) => l.parentId === shelf.id),
      })),
  }));
};

const json = (res, code, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*',
  });
  res.end(payload);
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  const method = req.method ?? 'GET';
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    const ok = (data) => json(res, 200, { ok: true, data });
    const fail = (code, message) => json(res, code, { ok: false, message });

    if (method === 'OPTIONS') return json(res, 204, {});

    // ── auth ──
    if (path === '/api/v1/health')
      return ok({ status: 'ok', uptime: 1, service: 'api', release: 'mock' });
    if (path === '/api/v1/auth/login' && method === 'POST')
      return ok({ accessToken: 'mock-token', user: state.user });
    if (path === '/api/v1/auth/me') return ok(state.user);
    if (path === '/api/v1/auth/logout') return ok({});

    // ── dashboard / analytics / meta / settings ──
    if (path === '/api/v1/dashboard/summary')
      return ok({
        products: state.products.length,
        lowStock: 2,
        inventoryWithoutLocation: 0,
        todaySales: 3,
        todayRevenue: 4_500_000,
        debtors: 1,
        productsCreated: 5,
      });
    if (path === '/api/v1/analytics/overview')
      return ok({
        series: { visits: [3, 5, 2, 8], sales: [1, 2, 1, 4] },
        kpis: { visits: 18, orders: 8, conversion: 44, revenue: 12_000_000 },
        topPages: [{ path: '/category/lent', visits: 9 }],
        topProducts: state.products.slice(0, 3).map((p) => ({ id: p.id, name: p.name, views: 4 })),
        topSearches: [{ term: 'لنت ۲۰۶', count: 6 }],
      });
    if (path === '/api/v1/public/meta')
      return ok({
        siteName: 'سلیم‌وند (پیش‌نمایش)',
        metaDescription: 'پیش‌نمایش محلی',
        contactPhone: '۰۹۱۲۰۰۰۰۰۰۰',
        logoUrl: null,
      });
    if (path === '/api/v1/settings' && method === 'GET')
      return ok({
        siteName: 'سلیم‌وند (پیش‌نمایش)',
        metaDescription: 'پیش‌نمایش',
        indexable: true,
        contactPhone: '۰۹۱۲۰۰۰۰۰۰۰',
        address: 'للیان',
        instagram: null,
        telegram: null,
        whatsapp: null,
        logoUrl: null,
        priceDisplayMode: 'show',
        adminInquiryUsername: 'admin',
      });
    if (path === '/api/v1/settings' && method === 'PUT') return ok(body);

    // ── references ──
    if (path === '/api/v1/categories') return ok(state.categories);
    if (path === '/api/v1/brands') return ok(state.brands);
    if (path === '/api/v1/suppliers') return ok(state.suppliers);
    if (path === '/api/v1/locations') {
      // Deliberately return BOTH shapes (flat + nested) like the real API,
      // so the panel's tree-walking code paths are exercised.
      const flat = [...state.locations];
      return ok([...flat, ...locationTree()]);
    }
    if (path === '/api/v1/locations' && method === 'POST') {
      const location = {
        id: nextId(15),
        name: body.name ?? 'جدید',
        code: body.code ?? 'x',
        type: body.type ?? 'shelf',
        parentId: body.parentId ?? null,
      };
      state.locations.push(location);
      return ok(location);
    }
    let lm = path.match(/^\/api\/v1\/locations\/([^/]+)$/);
    if (lm && method === 'PATCH') {
      const location = state.locations.find((l) => l.id === lm[1]);
      if (!location) return fail(404, 'مکان پیدا نشد');
      Object.assign(location, {
        ...('name' in body ? { name: body.name } : {}),
        ...('code' in body ? { code: body.code } : {}),
        ...('parentId' in body ? { parentId: body.parentId } : {}),
      });
      return ok(location);
    }
    if (lm && method === 'DELETE') {
      state.locations = state.locations.filter((l) => l.id !== lm[1]);
      return ok({ detachedItems: 0 });
    }
    if (path === '/api/v1/vehicles/tree')
      return ok(state.makes.map((make) => ({
        ...make,
        models: make.models.map((model) => ({ ...model, makeName: make.name })),
      })));

    // ── inventory ──
    if (path === '/api/v1/inventory/items' && method === 'GET') {
      const items = state.products.flatMap((p) => p.inventoryItems);
      return ok(items);
    }
    if (path === '/api/v1/inventory/items' && method === 'POST') {
      const product = state.products.find((p) => p.id === body.productId);
      if (!product) return fail(404, 'محصول پیدا نشد');
      const location = state.locations.find((l) => l.id === body.locationId) ?? null;
      const item = {
        id: nextId(9),
        productId: product.id,
        brandId: body.brandId ?? null,
        brand: state.brands.find((b) => b.id === body.brandId) ?? null,
        supplierId: body.supplierId ?? null,
        supplier: state.suppliers.find((s) => s.id === body.supplierId) ?? null,
        barcode: body.barcode ?? `6009990000${++seq % 10}`,
        quantity: body.initialQuantity ?? 0,
        purchasePrice: body.purchasePrice ?? 0,
        salePrice: body.salePrice ?? 0,
        minStock: body.minStock ?? 0,
        locationId: location?.id ?? null,
        location: location ? { ...location, parent: { name: 'انبار اصلی' } } : null,
        basketId: body.basketId ?? null,
        basket: state.locations.find((l) => l.id === body.basketId) ?? null,
        notes: null,
      };
      product.inventoryItems.push(item);
      return ok(item);
    }
    let im = path.match(/^\/api\/v1\/inventory\/items\/([^/]+)$/);
    if (im && method === 'PATCH') {
      const item = state.products.flatMap((p) => p.inventoryItems).find((i) => i.id === im[1]);
      if (!item) return fail(404, 'قلم پیدا نشد');
      if ('supplierId' in body) {
        item.supplierId = body.supplierId;
        item.supplier = state.suppliers.find((s) => s.id === body.supplierId) ?? null;
      }
      return ok(item);
    }
    if (im && method === 'DELETE') {
      for (const p of state.products)
        p.inventoryItems = p.inventoryItems.filter((i) => i.id !== im[1]);
      return ok({ detachedItems: 0 });
    }
    if (/^\/api\/v1\/inventory\/items\/[^/]+\/transactions$/.test(path)) return ok([]);
    if (/^\/api\/v1\/inventory\/items\/[^/]+\/price-history$/.test(path)) return ok([]);
    if (path === '/api/v1/inventory/adjust' && method === 'POST') return ok({});
    if (path === '/api/v1/inventory/receive' && method === 'POST') {
      const item = state.products
        .flatMap((p) => p.inventoryItems)
        .find((i) => i.id === body.itemId);
      if (item) item.quantity += body.quantity ?? 0;
      return ok({});
    }
    if (path === '/api/v1/inventory/transfer' && method === 'POST') {
      const item = state.products
        .flatMap((p) => p.inventoryItems)
        .find((i) => i.id === body.itemId);
      if (item) {
        const location = state.locations.find((l) => l.id === body.locationId) ?? null;
        item.locationId = location?.id ?? null;
        item.location = location ? { ...location, parent: { name: 'انبار اصلی' } } : null;
        item.basketId = body.basketId ?? null;
        item.basket = state.locations.find((l) => l.id === body.basketId) ?? null;
      }
      return ok({});
    }
    if (path === '/api/v1/inventory/low-stock')
      return ok(
        state.products
          .flatMap((p) => p.inventoryItems)
          .filter((i) => i.minStock != null && i.quantity < i.minStock),
      );
    if (path.startsWith('/api/v1/inventory/labels')) return ok({ items: [], baskets: [] });
    if (path.startsWith('/api/v1/inventory/barcode/')) {
      const code = decodeURIComponent(path.split('/').pop() ?? '');
      const item = state.products
        .flatMap((p) => p.inventoryItems)
        .find((i) => i.barcode === code);
      return item ? ok(item) : fail(404, 'قلمی با این بارکد پیدا نشد');
    }
    if (path === '/api/v1/reports/inventory/export')
      return ok('qty,code\n5,P-1001');

    // ── media (minimal) ──
    if (/^\/api\/v1\/media\/products\/[^/]+\/(url|select)$/.test(path) && method === 'POST')
      return ok({ id: nextId(12), path: 'https://example.com/img.jpg', alt: body.alt ?? '' });
    if (/^\/api\/v1\/media\/products\/[^/]+\/upload$/.test(path) && method === 'POST')
      return ok({ id: nextId(12), path: 'https://example.com/upload.jpg', alt: '' });
    if (/^\/api\/v1\/media\/products\/[^/]+\/reorder$/.test(path) && method === 'PATCH')
      return ok({});
    if (path === '/api/v1/media') return ok([]);

    // ── products ──
    if (path === '/api/v1/products' && method === 'GET') return ok(state.products);
    if (path === '/api/v1/products/seo-keywords/regenerate') return ok({});
    if (/^\/api\/v1\/products\/[^/]+\/backup\/export$/.test(path)) return ok({});
    if (path === '/api/v1/products' && method === 'POST') {
      const category = state.categories.find((c) => c.id === body.categoryId);
      if (!body.name || !category) return fail(400, 'نام محصول و دسته‌بندی الزامی است');
      const product = makeProduct({
        name: body.name,
        categoryId: category.id,
        category,
        description: body.description ?? null,
        partNumber: body.partNumber ?? null,
        status: body.status ?? 'active',
        seoKeywords: body.seoKeywords ?? [],
        inventoryItems: (body.items ?? []).map((item, i) => {
          const location = state.locations.find((l) => l.id === item.locationId) ?? null;
          return {
            id: nextId(13 + i),
            productId: '',
            brandId: item.brandId ?? null,
            brand: state.brands.find((b) => b.id === item.brandId) ?? null,
            supplierId: item.supplierId ?? null,
            supplier: state.suppliers.find((s) => s.id === item.supplierId) ?? null,
            barcode: item.barcode ?? '6000000000000',
            quantity: item.initialQuantity ?? 0,
            purchasePrice: item.purchasePrice ?? 0,
            salePrice: item.salePrice ?? 0,
            minStock: item.minStock ?? 0,
            locationId: location?.id ?? null,
            location: location ? { ...location, parent: { name: 'انبار اصلی' } } : null,
            basketId: item.basketId ?? null,
            basket: state.locations.find((l) => l.id === item.basketId) ?? null,
            notes: null,
          };
        }),
      });
      product.inventoryItems.forEach((item) => (item.productId = product.id));
      state.products.unshift(product);
      return ok({ id: product.id, name: product.name, code: product.code });
    }
    let m = path.match(/^\/api\/v1\/products\/([^/]+)$/);
    if (m && method === 'GET') {
      const product = state.products.find((p) => p.id === m[1]);
      return product ? ok(product) : fail(404, 'محصول پیدا نشد');
    }
    if (m && method === 'PATCH') {
      const product = state.products.find((p) => p.id === m[1]);
      if (!product) return fail(404, 'محصول پیدا نشد');
      Object.assign(product, {
        ...('name' in body ? { name: body.name } : {}),
        ...('description' in body ? { description: body.description } : {}),
        ...('partNumber' in body ? { partNumber: body.partNumber } : {}),
        ...('status' in body ? { status: body.status } : {}),
        ...('seoTitle' in body ? { seoTitle: body.seoTitle } : {}),
        ...('seoDescription' in body ? { seoDescription: body.seoDescription } : {}),
      });
      return ok(product);
    }
    if (m && method === 'DELETE') {
      const product = state.products.find((p) => p.id === m[1]);
      if (product) product.deletedAt = new Date().toISOString();
      state.products = state.products.filter((p) => p.id !== m[1]);
      return ok({});
    }
    if (/^\/api\/v1\/products\/[^/]+\/compat$/.test(path) && method === 'PUT') return ok({});

    return fail(404, `در پیش‌نمایش پیاده‌سازی نشده: ${method} ${path}`);
  });
});

const port = Number(process.env.MOCK_PORT ?? 4000);
server.listen(port, '0.0.0.0', () => console.log(`mock api on :${port}`));
