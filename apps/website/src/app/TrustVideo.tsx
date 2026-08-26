'use client';

import { useState } from 'react';

export function TrustVideo({ videoId }: { videoId?: string }) {
  const [started, setStarted] = useState(false);
  if (!videoId) return null;
  return (
    <section className="trust-video" id="video">
      <div>
        <p className="eyebrow">اعتماد قبل از خرید</p>
        <h2>انبار و نحوهٔ ارسال را ببینید</h2>
        <p>ویدئوی معرفی فروشگاه، قفسه‌بندی و بسته‌بندی قطعات روی آپارات میزبانی می‌شود.</p>
      </div>
      <div className="video-frame">
        {started ? <iframe title="ویدئوی معرفی فروشگاه سلیم وند" src={`https://www.aparat.com/video/video/embed/videohash/${encodeURIComponent(videoId)}/vt/frame`} allowFullScreen /> : <button className="video-placeholder" onClick={() => setStarted(true)} aria-label="پخش ویدئوی معرفی فروشگاه"><span className="play-icon">▶</span><span>پخش ویدئوی معرفی</span><small>فقط پس از کلیک بارگذاری می‌شود</small></button>}
      </div>
    </section>
  );
}
