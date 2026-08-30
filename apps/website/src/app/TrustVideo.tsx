'use client';

import { extractAparatVideoId } from '@salimvand/shared';

/**
 * The store's trust video, embedded with the official Aparat iframe. The
 * player loads with the page (the operator wants the video ready before the
 * click) while playback stays in the visitor's hands — Aparat's own player
 * shows the poster and play button. `variant="hero"` renders the compact
 * card that sits inside the homepage hero; `variant="section"` renders the
 * full-width band. The operator may paste a bare Aparat hash or a full link.
 */
export function TrustVideo({
  videoId,
  variant = 'section',
}: {
  videoId?: string;
  variant?: 'hero' | 'section';
}) {
  const resolvedVideoId = extractAparatVideoId(videoId ?? '');
  const player = (
    <div className="video-frame">
      {resolvedVideoId ? (
        <iframe
          title="ویدئوی معرفی فروشگاه سلیم وند"
          src={`https://www.aparat.com/video/video/embed/videohash/${encodeURIComponent(resolvedVideoId)}/vt/frame`}
          allowFullScreen
        />
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
