'use client';

import { useState } from 'react';

/**
 * Lazy Aparat embed: the iframe (and its third-party scripts) only load after
 * the visitor clicks play — exactly like the homepage trust video.
 */
export function AparatVideo({
  videoId,
  title = 'ویدئوی محصول',
}: {
  videoId: string;
  title?: string;
}) {
  const [started, setStarted] = useState(false);
  return (
    <section className="product-video">
      <div className="product-video-head">
        <h2>{title}</h2>
        <p>نصب و بررسی این قطعه روی آپارات منتشر شده است.</p>
      </div>
      <div className="video-frame">
        {started ? (
          <iframe
            title={title}
            src={`https://www.aparat.com/video/video/embed/videohash/${encodeURIComponent(videoId)}/vt/frame`}
            allowFullScreen
          />
        ) : (
          <button className="video-placeholder" onClick={() => setStarted(true)}>
            <span className="play-icon">▶</span>
            <span>پخش ویدئو</span>
            <small>فقط پس از کلیک بارگذاری می‌شود</small>
          </button>
        )}
      </div>
    </section>
  );
}
