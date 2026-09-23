import type { Metadata, Viewport } from 'next';
import { APP_NAME } from '@salimvand/shared';
import { getStoreInfo } from './store-info';
import 'vazirmatn/Vazirmatn-font-face.css';
import './styles.css';

const SITE_THEME_COLOR = '#071c30';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: SITE_THEME_COLOR,
};

// The favicon is operator-configurable from the admin settings; read the same
// store meta as the pages so the browser tab icon follows the panel.
export async function generateMetadata(): Promise<Metadata> {
  const info = await getStoreInfo();
  const base = process.env.PUBLIC_SITE_URL ?? 'https://salimvand.ir';
  const description =
    'خرید و استعلام قیمت لوازم یدکی و قطعات خودرو، برندها و قطعات مناسب خودرو در میاندوآب از فروشگاه سلیم وند.';
  return {
    metadataBase: new URL(base),
    title: { default: `${APP_NAME} | آذین خودرو`, template: `%s | ${APP_NAME}` },
    description,
    keywords: [
      'لوازم یدکی خودرو',
      'قطعات خودرو',
      'لوازم داخلی خودرو',
      'قطعات ماشین',
      'قطعات خودرو میاندوآب',
      'سلیم وند',
    ],
    alternates: { canonical: '/' },
    openGraph: {
      type: 'website',
      locale: 'fa_IR',
      url: base,
      siteName: APP_NAME,
      title: `${APP_NAME} | آذین خودرو`,
      description,
    },
    twitter: { card: 'summary_large_image', title: APP_NAME, description },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: 'black-translucent',
      title: APP_NAME,
    },
    icons: info.faviconUrl ? { icon: { url: info.faviconUrl } } : undefined,
  };
}
/**
 * Applies the saved skin before first paint. Static string, no user input —
 * the only `dangerouslySetInnerHTML` usage besides the JSON-LD block below.
 */
const themeBootstrap =
  "(function(){try{var t=localStorage.getItem('salimvand.theme');if(t==='dark'||t==='light'){document.documentElement.dataset.theme=t;}}catch(e){}})();";

/** Flags the page as scrolled. The fixed mobile call/routing bars stay
 * translated off-screen until the first scroll — on the initial viewport
 * the sticky catalog search naturally sits where those bars would be, and
 * they used to end up hidden underneath it. Static string, no user input. */
const scrollFlagBootstrap =
  "(function(){try{var e=document.documentElement;var u=function(){e.classList.toggle('is-scrolled',window.scrollY>80)};u();window.addEventListener('scroll',u,{passive:true});}catch(e){}})();";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const info = await getStoreInfo();
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'AutoPartsStore',
        '@id': 'https://salimvand.ir/#store',
        name: info.name || 'فروشگاه آذین خودرو سلیم وند',
        alternateName: 'فروشگاه سلیم وند',
        url: 'https://salimvand.ir',
        image: info.logoUrl || undefined,
        telephone: info.phones[0] || undefined,
        address: {
          '@type': 'PostalAddress',
          streetAddress: info.address || undefined,
          addressLocality: 'میاندوآب',
          addressRegion: 'آذربایجان غربی',
          addressCountry: 'IR',
        },
        areaServed: ['میاندوآب', 'آذربایجان غربی', 'ایران'],
        priceRange: '$$',
      },
      {
        '@type': 'WebSite',
        '@id': 'https://salimvand.ir/#website',
        url: 'https://salimvand.ir',
        name: 'فروشگاه سلیم وند',
        inLanguage: 'fa-IR',
        potentialAction: {
          '@type': 'SearchAction',
          target: 'https://salimvand.ir/?q={search_term_string}',
          'query-input': 'required name=search_term_string',
        },
      },
    ],
  };
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        <script dangerouslySetInnerHTML={{ __html: scrollFlagBootstrap }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}
