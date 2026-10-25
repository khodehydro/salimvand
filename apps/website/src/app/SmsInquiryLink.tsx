'use client';

import { useEffect, useState } from 'react';
import { smsInquiryHref } from './sms-inquiry';

export function SmsInquiryLink({
  phone,
  productName,
  className,
}: {
  phone: string;
  productName: string;
  className?: string;
}) {
  const [ios, setIos] = useState(false);
  useEffect(() => {
    // iPadOS can identify itself as a desktop Mac. Keep navigator out of SSR
    // and the first render so the server and hydration markup always agree.
    setIos(
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    );
  }, []);
  const href = smsInquiryHref(phone, productName, ios);
  if (!href) return null;
  return (
    <a
      className={className}
      href={href}
      aria-label={`پیامک برای ${productName}`}
      title="باز کردن برنامهٔ پیامک با متن آمادهٔ استعلام محصول"
    >
      پیامک
    </a>
  );
}
