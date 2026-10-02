import type { Metadata, Viewport } from 'next';
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
// The title/description come from the panel too (store.profile.seo) so the
// browser tab is never a hard-coded string.
export async function generateMetadata(): Promise<Metadata> {
  const info = await getStoreInfo();
  const base = (process.env.PUBLIC_SITE_URL ?? 'https://salimvand.ir').replace(/\/+$/, '');
  const title = `${info.seo.title} | ${info.name}`;
  const description = info.seo.description;
  return {
    metadataBase: new URL(base),
    title: { default: title, template: `%s | ${info.name}` },
    description,
    keywords: [
      'لوازم یدکی خودرو',
      'قطعات خودرو',
      'لوازم داخلی خودرو',
      'قطعات ماشین',
      `قطعات خودرو ${info.address.split('،')[0]?.trim() || 'میاندوآب'}`,
      info.name,
    ],
    alternates: { canonical: '/' },
    openGraph: {
      type: 'website',
      locale: 'fa_IR',
      url: base,
      siteName: info.name,
      title,
      description,
    },
    twitter: { card: 'summary_large_image', title, description },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: 'black-translucent',
      title: info.name,
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

/**
 * Protects public website media and content from downloading and copying:
 * - Prevents contextmenu (right-click / long-press menus) outside form inputs
 * - Prevents text copying / cutting outside form inputs
 * - Prevents drag-and-drop of images to save them
 * - Intercepts shortcuts: Ctrl/Cmd+S (save page), Ctrl/Cmd+U (view source),
 *   Ctrl/Cmd+C (copy text outside form inputs).
 */
const contentProtectionBootstrap =
  "(function(){try{var isEditable=function(e){var tag=(e.target&&e.target.tagName)?e.target.tagName.toUpperCase():'';return tag==='INPUT'||tag==='TEXTAREA'};document.addEventListener('contextmenu',function(e){if(!isEditable(e)){e.preventDefault();return false;}},{capture:true});document.addEventListener('copy',function(e){if(!isEditable(e)){e.preventDefault();return false;}},{capture:true});document.addEventListener('cut',function(e){if(!isEditable(e)){e.preventDefault();return false;}},{capture:true});document.addEventListener('dragstart',function(e){e.preventDefault();return false;},{capture:true});document.addEventListener('keydown',function(e){var mod=e.ctrlKey||e.metaKey;if(!mod)return;var k=(e.key||'').toLowerCase();if(k==='s'||k==='u'||(k==='c'&&!isEditable(e))){e.preventDefault();return false;}},{capture:true});}catch(e){}})();";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const info = await getStoreInfo();
  const base = (process.env.PUBLIC_SITE_URL ?? 'https://salimvand.ir').replace(/\/+$/, '');
  // Social/channel links set in the panel; placeholders (bare t.me/ble.ir roots)
  // are excluded so Google only indexes real, operator-configured profiles.
  const sameAs = [info.telegram, info.bale, info.instagram].filter((link) => {
    if (!link) return false;
    try {
      const url = new URL(link);
      return Boolean(url.pathname.replace(/\/+$/, ''));
    } catch {
      return false;
    }
  });
  const phones = info.phones.map((phone) => phone.replace(/[^0-9+]/g, '')).filter(Boolean);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'AutoPartsStore',
        '@id': `${base}/#store`,
        name: info.name,
        url: base,
        image: info.logoUrl || undefined,
        // Every configured phone number becomes indexable — the primary one
        // also stays on `telephone` for rich-result compatibility.
        telephone: phones[0] || undefined,
        contactPoint: phones.map((phone) => ({
          '@type': 'ContactPoint',
          contactType: 'customer service',
          telephone: phone,
          areaServed: 'IR',
          availableLanguage: 'fa-IR',
        })),
        address: {
          '@type': 'PostalAddress',
          streetAddress: info.address || undefined,
          addressLocality: 'میاندوآب',
          addressRegion: 'آذربایجان غربی',
          addressCountry: 'IR',
        },
        // Panel-configured coordinates feed both the geo signal and maps.
        geo:
          info.nav.lat != null && info.nav.lng != null
            ? { '@type': 'GeoCoordinates', latitude: info.nav.lat, longitude: info.nav.lng }
            : undefined,
        openingHoursSpecification:
          info.open && info.close
            ? {
                '@type': 'OpeningHoursSpecification',
                dayOfWeek: ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'],
                opens: info.open,
                closes: info.close,
              }
            : undefined,
        // Telegram / Bale / Instagram channel IDs from the panel settings.
        sameAs: sameAs.length ? sameAs : undefined,
        areaServed: ['میاندوآب', 'آذربایجان غربی', 'ایران'],
        priceRange: '$$',
      },
      {
        '@type': 'WebSite',
        '@id': `${base}/#website`,
        url: base,
        name: info.name,
        inLanguage: 'fa-IR',
        potentialAction: {
          '@type': 'SearchAction',
          target: `${base}/?q={search_term_string}`,
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
        <script dangerouslySetInnerHTML={{ __html: contentProtectionBootstrap }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}
