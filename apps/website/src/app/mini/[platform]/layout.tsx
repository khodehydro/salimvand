import { notFound } from 'next/navigation';
import { isMiniAppPlatform } from '@salimvand/shared';
import { getStoreInfo } from '../../store-info';
import { PUBLIC_SITE_URL } from '../../config';
import { MiniChrome } from '../MiniChrome';

export default async function PlatformLayout({
  params,
  children,
}: {
  params: Promise<{ platform: string }>;
  children: React.ReactNode;
}) {
  const { platform } = await params;
  if (!isMiniAppPlatform(platform)) notFound();
  const info = await getStoreInfo();
  return (
    <MiniChrome platform={platform} name={info.name} logo={info.logoUrl} siteUrl={PUBLIC_SITE_URL}>
      {children}
    </MiniChrome>
  );
}
