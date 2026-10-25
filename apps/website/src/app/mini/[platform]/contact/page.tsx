import { notFound } from 'next/navigation';
import { isMiniAppPlatform, miniAppPath } from '@salimvand/shared';
import { getStoreInfo, primaryPhone, telHref } from '../../../store-info';
import { MiniCopyButton } from '../../MiniCopyButton';
import { MiniExternalLink } from '../../MiniExternalLink';
import { MiniLink } from '../../MiniLink';

export default async function MiniContact({ params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!isMiniAppPlatform(platform)) notFound();
  const info = await getStoreInfo();
  const phone = telHref(info);
  return (
    <div className="mini-contact">
      <div className="mini-contact-heading">
        <span className="mini-eyebrow">کنارت هستیم</span>
        <h1>ارتباط با فروشگاه</h1>
        <p>برای انتخاب قطعه، تأیید موجودی و قیمت راهنمایی بگیر.</p>
      </div>
      <section className="mini-panel">
        <h2>{info.name}</h2>
        <p>{info.address}</p>
        <p className="mini-muted">{info.workingHours}</p>
        {phone.startsWith('tel:') ? (
          <>
            <a className="mini-contact-number" href={phone} dir="ltr">
              {primaryPhone(info)}
            </a>
            <a className="mini-primary" href={phone}>
              تماس با فروشگاه
            </a>
            <MiniCopyButton value={phone.slice(4)} label="کپی شمارهٔ تماس" />
          </>
        ) : (
          <p>شمارهٔ تماس هنوز ثبت نشده است.</p>
        )}
      </section>
      <section className="mini-panel">
        <h2>در پیام‌رسان‌ها همراه ما باش</h2>
        <div className="mini-action-row">
          <MiniExternalLink platform={platform} href={info.telegram} className="mini-secondary">
            تلگرام
          </MiniExternalLink>
          <MiniExternalLink platform={platform} href={info.bale} className="mini-secondary">
            بله
          </MiniExternalLink>
        </div>
        <p className="mini-muted">
          اگر تماس در این نسخه باز نشد، شماره را کپی کن و در برنامهٔ تماس وارد کن.
        </p>
      </section>
      <MiniLink href={miniAppPath(platform)} className="mini-text-link">
        بازگشت به محصولات ←
      </MiniLink>
    </div>
  );
}
