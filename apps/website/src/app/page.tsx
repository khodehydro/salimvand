import { LoadMoreProducts } from './LoadMoreProducts';
import { getCatalogPage } from './catalog-data';
import { catalogCanonicalPath, type CatalogPage } from './catalog-pagination';
import { CatalogFilters } from './CatalogFilters';
import { ThemeToggle } from './ThemeToggle';
import { NavigationButton } from './NavigationButton';
import { APP_NAME, STORE_BRAND, formatPersianNumber } from '@salimvand/shared';
import { StoreSlider } from './StoreSlider';
import { getStoreInfo, telHref, type StoreInfo } from './store-info';
import { StoreContact } from './PublicSubHeader';
import { trackVisit } from './analytics';

const apiUrl = process.env.API_URL ?? 'https://api.salimvand.ir/api/v1';
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

async function getProducts(query: string): Promise<CatalogPage> {
  try {
    return await getCatalogPage(new URLSearchParams(query));
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

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  // The home title/description are operator-editable from the panel
  // (Settings → Store information → SEO); store-info applies the fallbacks.
  const info = await getStoreInfo();
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (typeof value === 'string') query.set(key, value);
  return {
    alternates: { canonical: catalogCanonicalPath('/', query.toString()) },
    title: info.seo.title,
    description: info.seo.description,
    openGraph: { title: info.seo.title, description: info.seo.description },
  };
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  trackVisit('/');
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const key of [
    'q',
    'categoryId',
    'vehicleMakeId',
    'vehicleModelId',
    'vehicleTrimId',
    'brandId',
    'page',
  ])
    if (params[key]) query.set(key, params[key]!);
  if (params.inStock === 'true') query.set('inStock', 'true');
  const [products, filters, meta, info] = await Promise.all([
    getProducts(query.toString()),
    getFilters(),
    getMeta(),
    getStoreInfo(),
  ]);
  // vehicleMakeId only scopes the cascading vehicle dropdowns; the API filters
  // by model/trim, so it is not part of the products query.
  const telegram = info.telegram;
  const bale = info.bale;
  const instagram = info.instagram;
  return (
    <main className="site-shell">
      <header className="site-header">
        <a className="brand-lockup" href="/">
          {info.logoUrl ? (
            <img className="brand-logo" src={info.logoUrl} alt={info.name} />
          ) : (
            <span className="brand-mark">س</span>
          )}
          <span>
            <strong>{APP_NAME}</strong>
            <small>{info.header.tagline}</small>
          </span>
        </a>
        <nav className="desktop-nav">
          <a href="#catalog">{info.header.navCatalog}</a>
          <a href="#video">{info.header.navVideo}</a>
          <a href="#contact">{info.header.navContact}</a>
        </nav>
        <div className="header-tools">
          <ThemeToggle />
          <a className="button button-primary header-cta" href={telHref(info)}>
            {info.header.cta}
          </a>
        </div>
      </header>
      <section className="hero-section">
        <div className="hero-copy">
          <span className="eyebrow">{STORE_BRAND} · میاندوآب</span>
          <h1>{info.header.heroHeadline}</h1>
          <p>{info.header.heroSubheadline}</p>
          <div className="hero-actions">
            <a className="button button-light" href="#catalog">
              جست‌وجوی قطعه <span>←</span>
            </a>
            <a className="button button-outline-light" href={telHref(info)}>
              تماس سریع
            </a>
          </div>
          <div className="hero-trust">
            <b>{info.header.experienceYears}</b>
            <span>{info.header.experienceLabel}</span>
          </div>
        </div>
        <div className="hero-visual">
          <StoreSlider slides={info.slider.slides} storeName={info.name} />
        </div>
      </section>
      <section className="trust-strip">
        <span>قطعات خودروهای داخلی</span>
        <b>پژو</b>
        <b>سایپا</b>
        <b>ایران‌خودرو</b>
        <b>و سایر برندها</b>
      </section>
      <section className="catalog-section" id="catalog">
        {' '}
        <div className="section-heading">
          <div>
            <span className="eyebrow">کاتالوگ قطعات</span>
            <h2>قطعهٔ موردنظرت را پیدا کن</h2>
            <p>{formatPersianNumber(products.total)} نتیجه · فیلترها در آدرس صفحه ذخیره می‌شوند</p>
          </div>
          <span className="price-note">
            {info.pricing.showPrices ? 'قیمت‌های روز انبار' : 'قیمت فقط با استعلام'}
          </span>
        </div>
        <CatalogFilters key={query.toString()} filters={filters} params={params} />
        {products.items.length ? (
          <LoadMoreProducts
            key={query.toString()}
            initial={products}
            query={query.toString()}
            contact={{ tel: telHref(info), telegram: info.telegram, bale: info.bale }}
          />
        ) : (
          <div className="empty-state">
            <b>قطعه‌ای با این مشخصات پیدا نشد.</b>
            <span>فیلترها را پاک کنید یا عبارت دیگری جست‌وجو کنید.</span>
            <a href="/#catalog">پاک کردن فیلترها</a>
          </div>
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
      {/* has-nav stacks the bar above the quick-navigation buttons when the
          store coordinates are configured in the admin settings. */}
      <a
        className={
          info.nav.lat != null && info.nav.lng != null
            ? 'mobile-contact-bar has-nav'
            : 'mobile-contact-bar'
        }
        href={telHref(info)}
      >
        تماس سریع <span>برای استعلام قطعه</span> ←
      </a>
      <NavigationButton lat={info.nav.lat} lng={info.nav.lng} />
    </main>
  );
}
