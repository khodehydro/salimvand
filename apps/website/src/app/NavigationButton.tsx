'use client';

import { useState } from 'react';
import { geoIntentUrl, neshanRouteUrl } from '@salimvand/shared';

/**
 * Floating mobile «مسیریابی» button shown next to the quick-call bar. It
 * geolocates the visitor (best effort, 5s budget) and opens a drive route to
 * the store inside Neshan (smart nshn.ir link that launches the app) or via
 * the standard Android geo: chooser, which lists Balad and every other
 * installed map app. Everything (coordinates + preferred app) comes from the
 * admin settings; with no coordinates configured the button hides itself.
 */
export function NavigationButton({
  lat,
  lng,
  app,
  storeName,
}: {
  lat: number | null;
  lng: number | null;
  app: 'neshan' | 'balad' | 'both';
  storeName: string;
}) {
  const [busy, setBusy] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  if (lat == null || lng == null) return null;

  const locate = () =>
    new Promise<{ lat: number; lng: number } | null>((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
        () => resolve(null),
        { timeout: 5000, maximumAge: 60000, enableHighAccuracy: false },
      );
    });

  const openWith = async (target: 'neshan' | 'balad') => {
    setChooserOpen(false);
    if (target === 'balad') {
      // The geo: intent lets Balad (or any installed map app) route from the
      // visitor's current position to the store marker.
      window.location.href = geoIntentUrl(lat, lng, storeName);
      return;
    }
    setBusy(true);
    const origin = await locate();
    setBusy(false);
    window.open(neshanRouteUrl(lat, lng, origin), '_blank', 'noopener');
  };

  const handleMainClick = () => {
    if (app === 'both') setChooserOpen(true);
    else void openWith(app);
  };

  return (
    <>
      <button
        type="button"
        className="mobile-nav-button"
        onClick={handleMainClick}
        disabled={busy}
        aria-label="مسیریابی به فروشگاه"
      >
        {busy ? 'در حال دریافت موقعیت…' : '🧭 مسیریابی به فروشگاه'}
      </button>
      {chooserOpen && (
        <div
          className="nav-chooser"
          role="dialog"
          aria-label="انتخاب برنامهٔ مسیریابی"
          onClick={() => setChooserOpen(false)}
        >
          <div className="nav-chooser-sheet" onClick={(event) => event.stopPropagation()}>
            <b>مسیریابی به فروشگاه</b>
            <small>مبدا به‌طور خودکار موقعیت فعلی شما قرار می‌گیرد.</small>
            <button
              type="button"
              className="nav-choice neshan"
              onClick={() => void openWith('neshan')}
            >
              با نشان مسیریابی کن
            </button>
            <button
              type="button"
              className="nav-choice balad"
              onClick={() => void openWith('balad')}
            >
              با بلد مسیریابی کن
            </button>
            <button
              type="button"
              className="nav-choice-cancel"
              onClick={() => setChooserOpen(false)}
            >
              انصراف
            </button>
          </div>
        </div>
      )}
    </>
  );
}
