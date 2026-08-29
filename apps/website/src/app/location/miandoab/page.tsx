import { PublicSubHeader } from '../../PublicSubHeader';
import type { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'فروش لوازم داخلی خودرو در میاندوآب | سلیم وند',
  description:
    'فروش لوازم داخل کابین و قطعات خودروهای داخلی در میاندوآب، شهرستان میاندوآب، آذربایجان غربی توسط فروشگاه آذین خودرو سلیم وند.',
  alternates: { canonical: '/location/miandoab' },
};
export default function MiandoabPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'AutoPartsStore',
    name: 'فروشگاه آذین خودرو سلیم وند',
    alternateName: 'فروشگاه سلیم وند',
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'میاندوآب',
      addressRegion: 'آذربایجان غربی',
      addressCountry: 'IR',
    },
    areaServed: 'میاندوآب',
  };
  return (
    <main className="shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <PublicSubHeader context="آذین خودرو · میاندوآب" />
      <article className="product-page">
        <p className="eyebrow">آذین خودرو سلیم وند</p>
        <h1>فروش لوازم داخلی خودرو در میاندوآب</h1>
        <p>
          فروشگاه سلیم وند در شهرستان میاندوآب، آذربایجان غربی، تأمین‌کنندهٔ لوازم داخل کابین و
          قطعات خودروهای داخلی است.
        </p>
        <h2>خدمات فروشگاه</h2>
        <ul>
          <li>فروش لوازم داخلی خودرو</li>
          <li>فروش لوازم داخل کابین</li>
          <li>تأمین قطعات خودروهای داخلی</li>
          <li>استعلام موجودی و برندهای مختلف</li>
        </ul>
        <h2>خودروهای تحت پوشش</h2>
        <p>
          قطعات مناسب خودروهای ایران خودرو، سایپا، پژو، پراید، تیبا، سمند، دنا، ۲۰۶ و سایر خودروهای
          داخلی.
        </p>
        <h2>تماس و استعلام</h2>
        <p>برای اطلاع از موجودی و قیمت روز قطعه با فروشگاه آذین خودرو سلیم وند تماس بگیرید.</p>
      </article>
    </main>
  );
}
