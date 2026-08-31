import { baladDirectionsUrl } from '@salimvand/shared';

/**
 * Mobile «مسیریابی سریع» link pinned below the quick-call bar: one tap opens
 * Balad driving directions to the store — destination comes from the
 * coordinates configured in the admin settings (navLat/navLng) and Balad
 * picks up the visitor's current position as the origin. Renders nothing
 * when no coordinates are configured.
 */
export function NavigationButton({ lat, lng }: { lat: number | null; lng: number | null }) {
  if (lat == null || lng == null) return null;
  return (
    <a
      className="mobile-quick-nav"
      href={baladDirectionsUrl(lat, lng)}
      target="_blank"
      rel="noopener noreferrer"
    >
      🧭 مسیریابی سریع <span>مسیر تا فروشگاه با بلد</span>
    </a>
  );
}
