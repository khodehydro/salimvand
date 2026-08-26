import type { Metadata } from 'next';
import { APP_NAME } from '@salimvand/shared';
import './styles.css';

export const metadata: Metadata = { title: `${APP_NAME} | آذین خودرو`, description: 'فروش لوازم داخلی و قطعات خودرو در میاندوآب' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const jsonLd = { '@context': 'https://schema.org', '@type': 'Organization', name: 'فروشگاه آذین خودرو سلیم وند', alternateName: 'فروشگاه سلیم وند', url: 'https://salimvand.ir', address: { '@type': 'PostalAddress', addressLocality: 'میاندوآب', addressRegion: 'آذربایجان غربی', addressCountry: 'IR' } }; return <html lang="fa" dir="rtl"><body><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />{children}</body></html>;
}
