import type { MetadataRoute } from 'next';
export default function robots(): MetadataRoute.Robots { const base = process.env.APP_URL ?? 'https://salimvand.ir'; return { rules: { userAgent: '*', allow: '/', disallow: ['/admin', '/api/', '/search'] }, sitemap: `${base}/sitemap.xml` }; }
