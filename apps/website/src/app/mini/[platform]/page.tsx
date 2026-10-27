import { notFound } from 'next/navigation';
import { formatPersianNumber, isMiniAppPlatform, miniAppPath } from '@salimvand/shared';
import { getCatalogPage } from '../../catalog-data';
import { catalogApiQuery, catalogPageNumber } from '../../catalog-pagination';
import { MiniLoadMoreProducts } from '../MiniLoadMoreProducts';
import { trackVisit } from '../../analytics';
import { getMiniFilters } from '../mini-data';
import { MiniFilters } from '../MiniFilters';
import { MiniLink } from '../MiniLink';
import { MiniIcon } from '../MiniIcon';

export default async function MiniCatalog({
  params,
  searchParams,
}: {
  params: Promise<{ platform: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { platform } = await params;
  if (!isMiniAppPlatform(platform)) notFound();
  const base = miniAppPath(platform);
  const input = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams))
    if (typeof value === 'string') input.set(key, value);
  const query = catalogApiQuery(input, catalogPageNumber(input.get('page')));
  query.delete('pageSize');
  const values = Object.fromEntries(query);
  const [catalog, filters] = await Promise.all([
    getCatalogPage(query),
    getMiniFilters().catch(() => null),
  ]);
  trackVisit(base);
  const categoryHref = (id: string) => {
    const search = new URLSearchParams(query);
    search.delete('page');
    if (id) search.set('categoryId', id);
    else search.delete('categoryId');
    return base + (search.size ? `?${search}` : '');
  };
  return (
    <>
      <section className="mini-intro">
        <div>
          <span className="mini-eyebrow">قطعات خودرو، یک‌جا</span>
          <h1>قطعه‌ات رو پیدا کن.</h1>
          <p>جست‌وجو با نام قطعه یا شمارهٔ فنی</p>
        </div>
        <span className="mini-result-total">
          <b>{formatPersianNumber(catalog.total)}</b>محصول
        </span>
      </section>
      <MiniFilters
        key={query.toString()}
        base={base}
        params={values}
        filters={filters ?? { categories: [], vehicles: [], brands: [] }}
      />
      {!filters && (
        <p className="mini-muted" role="status">
          فهرست فیلترها موقتاً در دسترس نیست؛ جست‌وجوی نام قطعه همچنان فعال است.
        </p>
      )}
      {filters && filters.categories.length > 0 && (
        <nav className="mini-category-rail" aria-label="دسته‌بندی سریع">
          <MiniLink href={categoryHref('')} current={!values.categoryId ? 'page' : undefined}>
            همهٔ قطعات
          </MiniLink>
          {filters.categories.slice(0, 8).map((category) => (
            <MiniLink
              key={category.id}
              href={categoryHref(category.id)}
              current={values.categoryId === category.id ? 'page' : undefined}
            >
              {category.name}
            </MiniLink>
          ))}
        </nav>
      )}
      <section className="mini-results" id="catalog" aria-label="فهرست محصولات">
        <div className="mini-results-heading">
          <h2>{values.q ? `نتیجه برای «${values.q}»` : 'کاتالوگ محصولات'}</h2>
          <span>موجودی و اطلاعات فروشگاه</span>
        </div>
        {catalog.items.length ? (
          <MiniLoadMoreProducts
            key={`${base}?${query}`}
            initial={catalog}
            query={query.toString()}
            pagePath={base}
            productPath={`${base}/product`}
            gridClassName="mini-product-grid"
          />
        ) : (
          <div className="mini-empty">
            <MiniIcon name="search" />
            <h2>قطعه‌ای پیدا نشد</h2>
            <p>نام کوتاه‌تر، کد قطعه یا فیلتر دیگری را امتحان کن.</p>
            <MiniLink href={base} className="mini-primary">
              نمایش همهٔ محصولات
            </MiniLink>
          </div>
        )}
      </section>
      <p className="mini-end-note">
        <MiniLink href={`${base}/contact`}>اطلاعات تماس، نشانی و ساعت کاری فروشگاه ←</MiniLink>
      </p>
    </>
  );
}
