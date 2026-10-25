'use client';
import { useParams } from 'next/navigation';
import { isMiniAppPlatform, miniAppPath } from '@salimvand/shared';
import { MiniLink } from '../MiniLink';
export default function MissingProduct() {
  const { platform } = useParams<{ platform: string }>();
  return (
    <section className="mini-empty">
      <h1>این صفحه پیدا نشد</h1>
      <p>ممکن است محصول از فهرست فروشگاه خارج شده باشد.</p>
      <MiniLink
        href={isMiniAppPlatform(platform) ? miniAppPath(platform) : '/mini/web'}
        className="mini-primary"
      >
        بازگشت به کاتالوگ
      </MiniLink>
    </section>
  );
}
