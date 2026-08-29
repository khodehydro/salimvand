import { PublicSubHeader } from '../../PublicSubHeader';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

const api = process.env.API_URL ?? 'https://api.salimvand.ir/api/v1';
type VehicleModel = { id: string; name: string; makeName: string; slug: string };
type Product = { slug: string; name: string; code: string; availability: string; images: Array<{ path: string; thumbnailPath?: string; alt?: string }>; category: { name: string } };

async function getVehicle(slug: string): Promise<{ vehicle: VehicleModel; products: Product[] } | null> {
  try {
    const filters = await fetch(`${api}/public/filters`, { next: { revalidate: 300 } });
    const data = (await filters.json() as { data: { vehicles: Array<{ name: string; models: Array<{ id: string; name: string }> }> } }).data;
    const models = data.vehicles.flatMap((make) => make.models.map((model) => ({ id: model.id, name: model.name, makeName: make.name, slug: `${make.name}-${model.name}`.toLowerCase().replace(/\s+/g, '-') })));
    const model = models.find((item) => item.slug === slug);
    if (!model) return null;
    const response = await fetch(`${api}/public/products?vehicleModelId=${model.id}`, { next: { revalidate: 300 } });
    const products = (await response.json() as { data: Product[] }).data;
    return { vehicle: model, products };
  } catch { return null; }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const data = await getVehicle((await params).slug);
  return { title: data ? `قطعات مناسب ${data.vehicle.name} | فروشگاه سلیم وند` : 'خودرو پیدا نشد', description: data ? `کاتالوگ لوازم داخلی و قطعات مناسب ${data.vehicle.name} از فروشگاه سلیم وند میاندوآب.` : undefined, alternates: data ? { canonical: `/vehicle/${data.vehicle.slug}` } : undefined };
}

export default async function VehiclePage({ params }: { params: Promise<{ slug: string }> }) {
  const data = await getVehicle((await params).slug); if (!data) notFound();
  const jsonLd = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: `قطعات مناسب ${data.vehicle.name}`, url: `https://salimvand.ir/vehicle/${data.vehicle.slug}` };
  const breadcrumb = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'خانه', item: 'https://salimvand.ir' }, { '@type': 'ListItem', position: 2, name: data.vehicle.name, item: `https://salimvand.ir/vehicle/${data.vehicle.slug}` }] };
  return <main className="shell"><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} /><PublicSubHeader context="کاتالوگ خودرو" /><section className="catalog"><nav className="breadcrumb"><a href="/">خانه</a><span>←</span><span>{data.vehicle.name}</span></nav><p className="eyebrow">قطعات خودرو</p><h1>قطعات مناسب {data.vehicle.name}</h1>{data.products.length ? <div className="product-grid">{data.products.map((product) => <a className="product-card" href={`/product/${product.slug}`} key={product.slug}>{product.images[0] ? <img src={product.images[0].thumbnailPath ?? product.images[0].path} srcSet={product.images[0].thumbnailPath ? `${product.images[0].thumbnailPath} 400w, ${product.images[0].path} 900w` : undefined} sizes="(max-width: 620px) 50vw, (max-width: 900px) 33vw, 25vw" alt={product.images[0].alt ?? product.name} loading="lazy" /> : <div className="image-placeholder">قطعه خودرو</div>}<small>{product.category.name}</small><h2>{product.name}</h2><code>{product.code}</code><b className="available">{product.availability === 'in_stock' ? 'موجود' : 'استعلام موجودی'}</b></a>)}</div> : <div className="placeholder">هنوز قطعه‌ای برای این خودرو ثبت نشده است.</div>}</section></main>;
}
