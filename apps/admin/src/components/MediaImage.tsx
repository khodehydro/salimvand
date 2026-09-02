import { useState } from 'react';

/**
 * Media thumbnail that never fails silently: if the file cannot be loaded
 * (wrong path, missing Nginx /uploads location, stale deploy) the card shows
 * an explicit «فایل بارگذاری نشد» box with the exact URL instead of a
 * blank/broken image, so the operator can tell a serving problem from an
 * empty library.
 */
export function MediaImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <div className={`media-img-failed ${className ?? ''}`} title={src}>
        <b>⚠ فایل بارگذاری نشد</b>
        <small dir="ltr">{src}</small>
      </div>
    );
  return (
    <img
      className={className}
      src={src}
      alt={alt ?? 'رسانه'}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
