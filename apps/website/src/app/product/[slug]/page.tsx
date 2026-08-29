import { PublicSubHeader } from '../../PublicSubHeader';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

const apiUrl = process.env.API_URL ?? 'https://api.salimvand.ir/api/v1';
const contactPhone = process.env.PUBLIC_CONTACT_PHONE ?? '';
type Product = { name: string; slug: string; code: string; description?: string; seoTitle?: string; seoDescription?: string; availability: string; brands: Array<{ name: string; inStock: boolean }>; images?: Array<{ path: string; thumbnailPath?: string; alt?: string }> };

// The product payload comes from operator-controlled DB JSON, so its nested arrays
// cannot be trusted. Normalize them so the render never throws a 500.
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

async function getProduct(slug: string): Promise<Product | null> {
  try {
    const response = await fetch(`${apiUrl}/public/products/${encodeURIComponent(slug)}`, { next: { revalidate: 300 } });
    if (!response.ok) return null;
    const body = await response.json() as { data?: Product | null };
    const product = body.data;
    if (!product) return null;
    return { ...product, brands: asArray(product.brands), images: asArray(product.images) };
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const product = await getProduct((await params).slug); if (!product) return { title: 'محصول پیدا نشد | فروشگاه سلیم وند' };
  return { title: product.seoTitle ?? `${product.name} | فروشگاه سلیم وند`, description: product.seoDescription ?? product.description ?? `استعلام ${product.name} از فروشگاه سلیم وند میاندوآب`, alternates: { canonical: `/product/${product.slug}` }, openGraph: { title: product.seoTitle ?? product.name, description: product.seoDescription ?? product.description ?? '' } };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const product = await getProduct((await params).slug); if (!product) notFound();
  const jsonLd = { '@context': 'https://schema.org', '@type': 'Product', name: product.name, sku: product.code, description: product.description, image: product.images?.map((image) => image.path), brand: product.brands?.length ? { '@type': 'Brand', name: product.brands[0].name } : undefined }; const breadcrumb = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'خانه', item: 'https://salimvand.ir' }, { '@type': 'ListItem', position: 2, name: 'کاتالوگ محصولات', item: 'https://salimvand.ir/#catalog' }, { '@type': 'ListItem', position: 3, name: product.name, item: `https://salimvand.ir/product/${product.slug}` }] }; return <main className="shell"><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} /><PublicSubHeader context="آذین خودرو · میاندوآب" /><article className="product-page"><nav className="breadcrumb"><a href="/">خانه</a><span>←</span><a href="/#catalog">کاتالوگ</a><span>←</span><span>{product.name}</span></nav><div className="product-gallery">{product.images?.length ? product.images.map((image) => <img key={image.path} src={image.path} srcSet={image.thumbnailPath ? `${image.thumbnailPath} 400w, ${image.path} 900w` : undefined} sizes="(max-width: 700px) 100vw, 720px" alt={image.alt ?? product.name} />) : <div className="image-placeholder">تصویر محصول</div>}</div><p className="eyebrow">کاتالوگ قطعات خودرو</p><h1>{product.name}</h1><p className="code">کد محصول: {product.code}</p><p>{product.description ?? `برای استعلام ${product.name} با فروشگاه آذین خودرو سلیم وند تماس بگیرید.`}</p><div className="status">وضعیت: {product.availability === 'in_stock' ? 'موجود' : 'استعلام موجودی'}</div><h2>برندها</h2><ul>{product.brands.map((brand) => <li key={brand.name}>{brand.name} — {brand.inStock ? 'موجود' : 'ناموجود'}</li>)}</ul><a className="contact" href={contactPhone ? `tel:${contactPhone}` : '/#contact'}>تماس برای استعلام قیمت</a></article></main>;
}
