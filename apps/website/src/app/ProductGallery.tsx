'use client';

import { useRef, useState } from 'react';

/**
 * Product gallery as a slideshow. Multiple images can be browsed with the
 * prev/next arrows, the dot indicators, the thumbnails, or a swipe/drag
 * gesture — the large image uses the 900px WebP variant and thumbnails the
 * 400px one, both produced by the media pipeline on upload.
 */
export function ProductGallery({
  images,
  productName,
}: {
  images: Array<{ path: string; thumbnailPath?: string; alt?: string }>;
  productName: string;
}) {
  const [active, setActive] = useState(0);
  const pointerStart = useRef<number | null>(null);
  const count = images.length;
  const current = images[active];
  if (!current) return null;
  const go = (direction: 1 | -1) => setActive((index) => (index + direction + count) % count);
  return (
    <div className="product-gallery">
      <div
        className="gallery-stage"
        onPointerDown={(event) => {
          pointerStart.current = event.clientX;
        }}
        onPointerUp={(event) => {
          const start = pointerStart.current;
          pointerStart.current = null;
          if (start == null) return;
          const delta = event.clientX - start;
          if (Math.abs(delta) < 40) return;
          go(delta > 0 ? 1 : -1);
        }}
      >
        <img
          key={current.path}
          src={current.path}
          srcSet={
            current.thumbnailPath
              ? `${current.thumbnailPath} 400w, ${current.path} 900w`
              : undefined
          }
          sizes="(max-width: 700px) 100vw, 660px"
          alt={current.alt ?? productName}
          draggable={false}
        />
        {count > 1 && (
          <>
            <button
              type="button"
              className="gallery-nav gallery-prev"
              onClick={() => go(-1)}
              aria-label="تصویر قبلی"
            >
              ›
            </button>
            <button
              type="button"
              className="gallery-nav gallery-next"
              onClick={() => go(1)}
              aria-label="تصویر بعدی"
            >
              ‹
            </button>
            <div className="gallery-dots" role="tablist" aria-label="تصاویر محصول">
              {images.map((image, index) => (
                <button
                  key={image.path}
                  role="tab"
                  aria-selected={index === active}
                  className={index === active ? 'active' : ''}
                  onClick={() => setActive(index)}
                  aria-label={`تصویر ${index + 1}`}
                />
              ))}
            </div>
          </>
        )}
      </div>
      {count > 1 && (
        <div className="gallery-thumbs" aria-label="بندانگشتی تصاویر">
          {images.map((image, index) => (
            <button
              key={image.path}
              aria-selected={index === active}
              className={index === active ? 'active' : ''}
              onClick={() => setActive(index)}
              aria-label={`تصویر ${index + 1}`}
            >
              <img src={image.thumbnailPath ?? image.path} alt={image.alt ?? productName} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
