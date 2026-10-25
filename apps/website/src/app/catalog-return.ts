/** Public URL-only navigation intent; never stores host initData or user data. */
export const CATALOG_LEAVE_EVENT = 'salimvand:catalog-leave';
const SPA_BACK = 'salimvand.catalog.spa-back.v1';
export function noteCatalogSpaBack() {
  try {
    sessionStorage.setItem(
      SPA_BACK,
      JSON.stringify({ url: location.pathname + location.search, at: Date.now() }),
    );
  } catch {
    /* Private browsing. */
  }
}
export function consumeCatalogSpaBack(): boolean {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SPA_BACK) || 'null');
    sessionStorage.removeItem(SPA_BACK);
    return (
      saved?.url === location.pathname + location.search &&
      typeof saved.at === 'number' &&
      Date.now() >= saved.at &&
      Date.now() - saved.at < 30_000
    );
  } catch {
    return false;
  }
}
