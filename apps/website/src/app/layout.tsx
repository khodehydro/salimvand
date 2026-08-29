import type { Metadata } from 'next';
import { APP_NAME } from '@salimvand/shared';
import 'vazirmatn/Vazirmatn-font-face.css';
import './styles.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_SITE_URL ?? 'https://salimvand.ir'),
  title: `${APP_NAME} | آذین خودرو`,
  description: 'فروش لوازم داخلی و قطعات خودرو در میاندوآب',
};
/**
 * Applies the saved skin before first paint. Static string, no user input —
 * the only `dangerouslySetInnerHTML` usage besides the JSON-LD block below.
 */
const themeBootstrap =
  "(function(){try{var t=localStorage.getItem('salimvand.theme');if(t==='dark'||t==='light'){document.documentElement.dataset.theme=t;}}catch(e){}})();";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'فروشگاه آذین خودرو سلیم وند',
    alternateName: 'فروشگاه سلیم وند',
    url: 'https://salimvand.ir',
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'میاندوآب',
      addressRegion: 'آذربایجان غربی',
      addressCountry: 'IR',
    },
  };
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}
