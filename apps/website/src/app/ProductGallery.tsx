'use client';

import { useState } from 'react';

/**
 * Product gallery with thumbnail selection. The large image uses the 900px
 * WebP variant and thumbnails the 400px one, both produced by the media
 * pipeline on upload.
 */
export function ProductGallery({
  images,
  productName,
}: {
  images: Array<{ path: string; thumbnailPath?: string; alt?: string }>;
  productName: string;
}) {
  const [active, setActive] = useState(0);
  const current = images[active];
  if (!current) return null;
  return (
    <div className="product-gallery">
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
      />
      {images.length > 1 && (
        <div className="gallery-thumbs" role="tablist" aria-label="تصاویر محصول">
          {images.map((image, index) => (
            <button
              key={image.path}
              role="tab"
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
