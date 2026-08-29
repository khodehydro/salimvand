import { ThemeToggle } from './ThemeToggle';
import { APP_NAME, STORE_BRAND, formatPersianNumber } from '@salimvand/shared';
import { TrustVideo } from './TrustVideo';
import { getStoreInfo, telHref, type StoreInfo } from './store-info';
import { StoreContact } from './PublicSubHeader';

const apiUrl = process.env.API_URL ?? 'https://api.salimvand.ir/api/v1';
type Product = {
  slug: string;
  name: string;
  code: string;
  availability: string;
  brands: Array<{ name: string; inStock: boolean }>;
  compatibilities?: Array<{
    model: { name: string; make: { name: string } };
    trim?: { name: string } | null;
  }>;
  images: Array<{ path: string; thumbnailPath?: string; alt?: string }>;
  category: { name: string };
};
type Filter = { id: string; name: string; slug?: string };
type Vehicle = {
  id: string;
  name: string;
  models: Array<{ id: string; name: string; trims?: Array<{ id: string; name: string }> }>;
};
const emptyFilters = {
  categories: [] as Filter[],
  brands: [] as Filter[],
  vehicles: [] as Vehicle[],
};

// Defensive normalizers: the public API returns operator-controlled JSON from the
// database, so its shape cannot be trusted. These guards keep the render from
// throwing (which would surface as a 500 "Internal Server Error") when a field is
// missing or comes back as the wrong type (e.g. phones stored as an array).
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

async function getProducts(
  query: string,
): Promise<{ items: Product[]; total: number; totalPages: number; page: number }> {
  try {
    const response = await fetch(`${apiUrl}/public/products${query ? `?${query}` : ''}`, {
      next: { revalidate: 300 },
    });
    if (!response.ok) return { items: [], total: 0, totalPages: 0, page: 1 };
    const body = (await response.json()) as {
      data?: unknown;
      meta?: { total?: number; totalPages?: number; page?: number };
    };
    const items = asArray<Product>(body.data);
    const meta = body.meta ?? {};
    return {
      items,
      total: Number(meta.total ?? items.length) || 0,
      totalPages: Number(meta.totalPages ?? 1) || 1,
      page: Number(meta.page ?? 1) || 1,
    };
  } catch {
    return { items: [], total: 0, totalPages: 0, page: 1 };
  }
}
async function getFilters(): Promise<typeof emptyFilters> {
  try {
    const response = await fetch(`${apiUrl}/public/filters`, { next: { revalidate: 300 } });
    if (!response.ok) return emptyFilters;
    const body = (await response.json()) as { data?: Partial<typeof emptyFilters> };
    const data = body.data ?? {};
    return {
      categories: asArray(data.categories),
      brands: asArray(data.brands),
      vehicles: asArray(data.vehicles),
    };
  } catch {
    return emptyFilters;
  }
}
type StoreMeta = {
  profile?: {
    name?: string;
    phones?: string;
    address?: string;
    open?: string;
    close?: string;
    mapUrl?: string;
    instagram?: string;
  };
  trustVideo?: string | null;
  telegram?: { link?: string; username?: string };
  bale?: { link?: string; username?: string };
};
// Retained as a light wrapper on the shared server-side store info so the
// homepage and every SEO landing page read the exact same operator-configured
// contact/social/map data (phones, telegram, bale, instagram, map, hours).
const getMeta = async (): Promise<StoreMeta> => {
  const info = await getStoreInfo();
  return {
    profile: {
      name: info.name,
      phones: info.phones.join('، '),
      address: info.address,
      open: info.open,
      close: info.close,
      mapUrl: info.mapUrl,
      instagram: info.instagram,
    },
    trustVideo: info.trustVideo,
    telegram: { link: info.telegram },
    bale: { link: info.bale },
  } as StoreMeta;
};

export async function generateMetadata() {
  return {
    title: 'قطعات یدکی خودرو | فروشگاه سلیم وند',
    description: 'کاتالوگ قطعات یدکی خودرو با اعلام وضعیت موجودی و برندهای موجود در میاندوآب.',
  };
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const key of ['q', 'categoryId', 'vehicleModelId', 'vehicleTrimId', 'brandId', 'page'])
    if (params[key]) query.set(key, params[key]!);
  if (params.inStock === 'true') query.set('inStock', 'true');
  const [products, filters, meta, info] = await Promise.all([
    getProducts(query.toString()),
    getFilters(),
    getMeta(),
    getStoreInfo(),
  ]);
  const phone = info.phones[0]?.replace(/[^0-9+]/g, '') ?? '';
  const telegram = info.telegram;
  const bale = info.bale;
  const instagram = info.instagram;
  return (
    <main className="site-shell">
      <header className="site-header">
        <a className="brand-lockup" href="/">
          <span className="brand-mark">س</span>
          <span>
            <strong>{APP_NAME}</strong>
            <small>قطعات یدکی خودرو</small>
          </span>
        </a>
        <nav className="desktop-nav">
          <a href="#catalog">کاتالوگ</a>
          <a href="#video">ویدئوی فروشگاه</a>
          <a href="#contact">تماس</a>
        </nav>
        <div className="header-tools">
          <ThemeToggle />
          <a className="button button-primary header-cta" href={telHref(info)}>
            تماس سریع
          </a>
        </div>
      </header>
      <section className="hero-section">
        <div className="hero-copy">
          <span className="eyebrow">{STORE_BRAND} · میاندوآب</span>
          <h1>
            قطعهٔ ماشینت رو <em>پیدا کن</em>،<br />
            بقیه‌اش با ماست.
          </h1>
          <p>
            کاتالوگ زندهٔ قطعات یدکی خودرو با اعلام وضعیت موجودی و برندهای موجود در انبار. قیمت‌ها
            به‌دلیل نوسان بازار فقط با استعلام اعلام می‌شوند.
          </p>
          <div className="hero-actions">
            <a className="button button-light" href="#catalog">
              جست‌وجوی قطعه <span>←</span>
            </a>
            <a className="button button-outline-light" href={telHref(info)}>
              تماس سریع
            </a>
          </div>
          <div className="hero-trust">
            <b>۱۸ سال</b>
            <span>سابقهٔ تأمین قطعات یدکی</span>
          </div>
        </div>
        <div className="hero-visual">
          <div className="hero-card">
            <span className="hero-card-icon">✓</span>
            <b>موجودی واقعی انبار</b>
            <small>برند و وضعیت هر قطعه را ببینید</small>
            <div className="mini-status">
              <i /> به‌روزرسانی لحظه‌ای
            </div>
          </div>
          <div className="hero-float">
            بدون قیمت در سایت
            <br />
            <small>استعلام روزانه تلفنی</small>
          </div>
        </div>
      </section>
      <section className="trust-strip">
        <span>قطعات خودروهای داخلی</span>
        <b>پژو</b>
        <b>سایپا</b>
        <b>ایران‌خودرو</b>
        <b>و سایر برندها</b>
      </section>
      <TrustVideo videoId={meta.trustVideo ?? process.env.APARAT_VIDEO_ID} />
      <section className="catalog-section" id="catalog">
        <div className="section-heading">
          <div>
            <span className="eyebrow">کاتالوگ قطعات</span>
            <h2>قطعهٔ موردنظرت را پیدا کن</h2>
            <p>{formatPersianNumber(products.total)} نتیجه · فیلترها در آدرس صفحه ذخیره می‌شوند</p>
          </div>
          <span className="price-note">قیمت فقط با استعلام</span>
        </div>
        <form className="catalog-filters" method="get">
          <label className="search-field">
            <span>⌕</span>
            <input name="q" defaultValue={params.q} placeholder="نام قطعه یا شماره فنی..." />
          </label>
          <select name="brandId" defaultValue={params.brandId ?? ''}>
            <option value="">برند خودرو / قطعه</option>
            {filters.brands.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select name="vehicleModelId" defaultValue={params.vehicleModelId ?? ''}>
            <option value="">مدل خودرو</option>
            {filters.vehicles.flatMap((make) =>
              make.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {make.name} · {model.name}
                </option>
              )),
            )}
          </select>
          <select name="vehicleTrimId" defaultValue={params.vehicleTrimId ?? ''}>
            <option value="">تیپ / موتور</option>
            {filters.vehicles.flatMap((make) =>
              make.models.flatMap((model) =>
                (model.trims ?? []).map((trim) => (
                  <option key={trim.id} value={trim.id}>
                    {make.name} · {model.name} · {trim.name}
                  </option>
                )),
              ),
            )}
          </select>
          <select name="categoryId" defaultValue={params.categoryId ?? ''}>
            <option value="">دسته‌بندی</option>
            {filters.categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <label className="check-field">
            <input
              type="checkbox"
              name="inStock"
              value="true"
              defaultChecked={params.inStock === 'true'}
            />{' '}
            فقط موجود
          </label>
          <button className="button button-primary" type="submit">
            اعمال فیلتر
          </button>
          {query.toString() && (
            <a className="clear-filter" href="#catalog">
              پاک کردن
            </a>
          )}
        </form>
        {products.items.length ? (
          <div className="product-grid">
            {products.items.map((product) => (
              <a className="product-card" href={`/product/${product.slug}`} key={product.slug}>
                <div className="product-image">
                  {product.images[0] ? (
                    <img
                      src={product.images[0].thumbnailPath ?? product.images[0].path}
                      srcSet={
                        product.images[0].thumbnailPath
                          ? `${product.images[0].thumbnailPath} 400w, ${product.images[0].path} 900w`
                          : undefined
                      }
                      sizes="(max-width: 620px) 50vw, (max-width: 900px) 33vw, 25vw"
                      alt={product.images[0].alt ?? product.name}
                      loading="lazy"
                    />
                  ) : (
                    <span>قطعه خودرو</span>
                  )}
                  <span className={`status-badge ${product.availability}`}>
                    {product.availability === 'in_stock'
                      ? 'موجود'
                      : product.availability === 'low_stock'
                        ? 'موجود (کم)'
                        : product.availability === 'coming_soon'
                          ? 'به‌زودی'
                          : 'ناموجود'}
                  </span>
                </div>
                <span className="category-label">{product.category.name}</span>
                <h3>{product.name}</h3>
                <p className="compatibility">
                  {product.compatibilities
                    ?.slice(0, 2)
                    .map((item) => `${item.model.make.name} ${item.model.name}`)
                    .join(' · ') || 'مناسب خودروهای داخلی'}
                </p>
                <div className="brand-list">
                  {product.brands.slice(0, 4).map((brand) => (
                    <span className={brand.inStock ? 'brand-in' : 'brand-out'} key={brand.name}>
                      {brand.inStock ? '✓' : '×'} {brand.name}
                    </span>
                  ))}
                </div>
                <div className="card-footer">
                  <code>{product.code}</code>
                  <span>
                    استعلام قیمت <b>←</b>
                  </span>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <b>قطعه‌ای با این مشخصات پیدا نشد.</b>
            <span>فیلترها را پاک کنید یا عبارت دیگری جست‌وجو کنید.</span>
            <a href="#catalog">پاک کردن فیلترها</a>
          </div>
        )}
        {products.totalPages > 1 && (
          <nav className="pagination" aria-label="صفحه‌بندی">
            {Array.from({ length: products.totalPages }, (_, index) => {
              const page = index + 1;
              const next = new URLSearchParams(query.toString());
              next.set('page', String(page));
              return (
                <a
                  className={products.page === page ? 'current' : ''}
                  href={`/?${next.toString()}`}
                  key={page}
                >
                  {formatPersianNumber(page)}
                </a>
              );
            })}
          </nav>
        )}
      </section>
      <StoreContact info={info} variant="home" />
      <footer className="site-footer">
        <span>
          © {formatPersianNumber(new Date().getFullYear())} {STORE_BRAND}
        </span>
        <nav aria-label="پیوندهای فوتر">
          <a href="#catalog">کاتالوگ</a>
          <a href="#video">ویدئوی فروشگاه</a>
          <a href="#contact">تماس و آدرس</a>
          {/^https?:\/\/.+/.test(telegram) && (
            <a href={telegram} rel="noreferrer">
              تلگرام
            </a>
          )}
          {/^https?:\/\/.+/.test(bale) && (
            <a href={bale} rel="noreferrer">
              بله
            </a>
          )}
          {/^https?:\/\/.+/.test(instagram) && (
            <a href={instagram} rel="noreferrer">
              اینستاگرام
            </a>
          )}
        </nav>
        <span>قیمت‌ها روزانه تغییر می‌کنند · مبلغ نهایی هنگام صدور فاکتور قطعی است.</span>
      </footer>
      <a className="mobile-contact-bar" href={telHref(info)}>
        تماس سریع <span>برای استعلام قطعه</span> ←
      </a>
    </main>
  );
}
