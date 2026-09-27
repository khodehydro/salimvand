import { ProductCard } from '../../ProductCard';
import { getStoreInfo, telHref } from '../../store-info';
import { PublicSubHeader } from '../../PublicSubHeader';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

const api = process.env.API_URL ?? 'https://api.salimvand.ir/api/v1';
type VehicleModel = { id: string; name: string; makeName: string; slug: string };
type Product = {
  slug: string;
  name: string;
  code: string;
  availability: string;
  aparatVideoId?: string | null;
  brands?: Array<{ name: string; inStock: boolean }>;
  compatibilities?: Array<{
    model: { name: string; make: { name: string } };
    trim?: { name: string } | null;
  }>;
  images: Array<{ path: string; thumbnailPath?: string; alt?: string }>;
  category: { name: string };
};

async function getVehicle(
  slug: string,
): Promise<{ vehicle: VehicleModel; products: Product[] } | null> {
  try {
    const filters = await fetch(`${api}/public/filters`, { next: { revalidate: 300 } });
    const data = (
      (await filters.json()) as {
        data: { vehicles: Array<{ name: string; models: Array<{ id: string; name: string }> }> };
      }
    ).data;
    const models = data.vehicles.flatMap((make) =>
      make.models.map((model) => ({
        id: model.id,
        name: model.name,
        makeName: make.name,
        slug: `${make.name}-${model.name}`.toLowerCase().replace(/\s+/g, '-'),
      })),
    );
    const decodedSlug = decodeURIComponent(slug);
    const model = models.find((item) => item.slug === decodedSlug);
    if (!model) return null;
    const response = await fetch(`${api}/public/products?vehicleModelId=${model.id}`, {
      next: { revalidate: 300 },
    });
    const products = ((await response.json()) as { data: Product[] }).data;
    return { vehicle: model, products };
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const data = await getVehicle((await params).slug);
  const siteUrl = (process.env.PUBLIC_SITE_URL ?? 'https://salimvand.ir').replace(/\/$/, '');
  return {
    title: data ? `قطعات مناسب ${data.vehicle.name}` : 'خودرو پیدا نشد',
    description: data
      ? `کاتالوگ لوازم یدکی و قطعات مناسب ${data.vehicle.name} از فروشگاه سلیم وند میاندوآب.`
      : undefined,
    keywords: data
      ? [`قطعات ${data.vehicle.name}`, `لوازم یدکی ${data.vehicle.name}`, 'قطعات خودرو میاندوآب']
      : undefined,
    alternates: data
      ? { canonical: `${siteUrl}/vehicle/${encodeURIComponent(data.vehicle.slug)}` }
      : undefined,
    openGraph: data
      ? {
          type: 'website',
          title: `قطعات مناسب ${data.vehicle.name}`,
          description: `کاتالوگ قطعات ${data.vehicle.name}`,
          url: `${siteUrl}/vehicle/${encodeURIComponent(data.vehicle.slug)}`,
        }
      : undefined,
  };
}

export default async function VehiclePage({ params }: { params: Promise<{ slug: string }> }) {
  const data = await getVehicle((await params).slug);
  const info = await getStoreInfo();
  if (!data) notFound();
  const siteUrl = (process.env.PUBLIC_SITE_URL ?? 'https://salimvand.ir').replace(/\/$/, '');
  const canonicalUrl = `${siteUrl}/vehicle/${encodeURIComponent(data.vehicle.slug)}`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `قطعات مناسب ${data.vehicle.name}`,
    url: canonicalUrl,
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'خانه', item: siteUrl },
      {
        '@type': 'ListItem',
        position: 2,
        name: data.vehicle.name,
        item: canonicalUrl,
      },
    ],
  };
  return (
    <main className="shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />
      <PublicSubHeader context="کاتالوگ خودرو" />
      <section className="catalog">
        <nav className="breadcrumb">
          <a href="/">خانه</a>
          <span>←</span>
          <span>{data.vehicle.name}</span>
        </nav>
        <p className="eyebrow">قطعات خودرو</p>
        <h1>قطعات مناسب {data.vehicle.name}</h1>
        {data.products.length ? (
          <div className="product-grid">
            {data.products.map((product) => (
              <ProductCard
                key={product.slug}
                product={product}
                heading="h2"
                contact={{ tel: telHref(info), telegram: info.telegram, bale: info.bale }}
              />
            ))}
          </div>
        ) : (
          <div className="placeholder">هنوز قطعه‌ای برای این خودرو ثبت نشده است.</div>
        )}
      </section>
    </main>
  );
}
