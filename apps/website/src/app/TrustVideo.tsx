'use client';

import { useState } from 'react';
import { extractAparatVideoId } from '@salimvand/shared';

/**
 * The store's trust video. `variant="hero"` renders the compact player card
 * that sits inside the homepage hero (where the old info cards used to be);
 * `variant="section"` renders the previous full-width band. The iframe only
 * loads after the visitor clicks play, and the operator may paste a bare
 * Aparat hash or a full link.
 */
export function TrustVideo({
  videoId,
  variant = 'section',
}: {
  videoId?: string;
  variant?: 'hero' | 'section';
}) {
  const [started, setStarted] = useState(false);
  const resolvedVideoId = extractAparatVideoId(videoId ?? '');
  const player = (
    <div className="video-frame">
      {resolvedVideoId ? (
        started ? (
          <iframe
            title="ویدئوی معرفی فروشگاه سلیم وند"
            src={`https://www.aparat.com/video/video/embed/videohash/${encodeURIComponent(resolvedVideoId)}/vt/frame`}
            allowFullScreen
          />
        ) : (
          <button
            className="video-placeholder"
            onClick={() => setStarted(true)}
            aria-label="پخش ویدئوی معرفی فروشگاه"
          >
            <span className="play-icon">▶</span>
            <span>پخش ویدئوی معرفی</span>
            <small>فقط پس از کلیک بارگذاری می‌شود</small>
          </button>
        )
      ) : (
        <div className="video-placeholder video-empty" aria-label="ویدئوی فروشگاه">
          <span className="play-icon">▶</span>
          <span>ویدئوی معرفی فروشگاه به‌زودی اینجا منتشر می‌شود</span>
          <small>شناسهٔ ویدئو را در پنل ← تنظیمات وارد کنید</small>
        </div>
      )}
    </div>
  );
  if (variant === 'hero') {
    return (
      <div className="hero-video-card" id="video">
        <div className="hero-video-head">
          <b>ویدئوی فروشگاه</b>
          <small>انبار، قفسه‌بندی و نحوهٔ ارسال را ببینید</small>
        </div>
        {player}
      </div>
    );
  }
  return (
    <section className="trust-video" id="video">
      <div>
        <p className="eyebrow">اعتماد قبل از خرید</p>
        <h2>انبار و نحوهٔ ارسال را ببینید</h2>
        <p>ویدئوی معرفی فروشگاه، قفسه‌بندی و بسته‌بندی قطعات روی آپارات میزبانی می‌شود.</p>
      </div>
      {player}
    </section>
  );
}
