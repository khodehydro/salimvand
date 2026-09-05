'use client';

import { useState } from 'react';

export function ProductShareActions({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);
  return (
    <div className="product-share-actions" aria-label="اشتراک‌گذاری محصول">
      <button type="button" className="button button-copy" onClick={() => void copy()}>
        {copied ? 'کپی شد ✓' : 'کپی لینک'}
      </button>
      <a className="button button-bale" href={`https://ble.ir/share/url?url=${encodedUrl}&text=${encodedTitle}`} target="_blank" rel="noreferrer">اشتراک در بله</a>
      <a className="button button-whatsapp" href={`https://wa.me/?text=${encodedTitle}%20${encodedUrl}`} target="_blank" rel="noreferrer">واتساپ</a>
    </div>
  );
}
