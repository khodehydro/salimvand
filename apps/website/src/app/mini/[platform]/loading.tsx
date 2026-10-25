export default function LoadingCatalog() {
  return (
    <div className="mini-loading" role="status" aria-label="در حال دریافت محصولات">
      <div className="mini-skeleton mini-skeleton-title" />
      <div className="mini-skeleton mini-skeleton-search" />
      <div className="mini-loading-grid">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="mini-skeleton mini-skeleton-card" />
        ))}
      </div>
      <span className="mini-muted">در حال آماده‌کردن فروشگاه…</span>
    </div>
  );
}
