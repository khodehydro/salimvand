import type { MetadataRoute } from 'next';
export default function robots(): MetadataRoute.Robots {
  // PUBLIC_SITE_URL is the canonical storefront URL (https://salimvand.ir).
  // APP_URL is a legacy alias — prefer PUBLIC_SITE_URL for the sitemap.
  const base = (process.env.PUBLIC_SITE_URL ?? process.env.APP_URL ?? 'https://salimvand.ir').replace(/\/$/, '');
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Private / redirect-only routes must never be crawled:
      // /p/ is a 308 redirect to /product/, /i/ and /invoice/ are tokenized
      // private invoice links that expire and would otherwise surface as
      // soft-404 / 404 in Search Console.
      disallow: ['/admin', '/api/', '/search', '/p/', '/i/', '/invoice/'],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
