'use client';

import { extractAparatVideoId } from '@salimvand/shared';

/**
 * Product video embedded with the official Aparat iframe. The player loads
 * with the page and playback is left to the visitor (Aparat's poster + play
 * button) — no external aparat.com link, no click-to-reveal gate. The
 * section carries id="video" so catalog card badges can link straight to it.
 */
export function AparatVideo({
  videoId,
  title = 'ویدئوی محصول',
}: {
  videoId: string;
  title?: string;
}) {
  const resolvedVideoId = extractAparatVideoId(videoId);
  if (!resolvedVideoId) return null;
  return (
    <section className="product-video" id="video">
      <div className="product-video-head">
        <h2>{title}</h2>
        <p>نصب و بررسی این قطعه روی آپارات منتشر شده است.</p>
      </div>
      <div className="video-frame">
        <iframe
          title={title}
          src={`https://www.aparat.com/video/video/embed/videohash/${encodeURIComponent(resolvedVideoId)}/vt/frame`}
          allowFullScreen
        />
      </div>
    </section>
  );
}
