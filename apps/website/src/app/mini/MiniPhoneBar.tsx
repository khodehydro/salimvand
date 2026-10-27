'use client';
import { useEffect, useRef, useState } from 'react';
import { normalizeDigits } from '@salimvand/shared';
import { MiniIcon } from './MiniIcon';
import { MiniLink } from './MiniLink';

/** Clipboard API first; older messenger WebViews get a user-initiated fallback. */
export async function copyMiniPhone(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* Try the legacy WebView path below. */
  }
  const active = document.activeElement as HTMLElement | null;
  const field = document.createElement('textarea');
  field.value = value;
  field.readOnly = true;
  field.tabIndex = -1;
  field.setAttribute('aria-hidden', 'true');
  field.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;font-size:16px';
  document.body.append(field);
  try {
    field.focus({ preventScroll: true });
    field.select();
    field.setSelectionRange(0, value.length);
    return document.execCommand?.('copy') === true;
  } catch {
    return false;
  } finally {
    field.remove();
    active?.focus?.({ preventScroll: true });
  }
}

export function MiniPhoneBar({ phone = '', base }: { phone?: string; base: string }) {
  const number = normalizeDigits(phone).replace(/[^0-9+]/g, '');
  const valid = /^\+?\d{5,15}$/.test(number);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setMessage('');
  }, [number]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), message === 'شماره تماس کپی شد.' ? 3000 : 8000);
    return () => clearTimeout(timer);
  }, [message]);
  return (
    <footer className="mini-phone-bar" aria-label="تماس با فروشگاه">
      {valid ? (
        <>
          <a className="mini-phone-number" href={`tel:${number}`} aria-label="تماس با فروشگاه">
            <MiniIcon name="phone" />
            <span>
              <small>تماس با فروشگاه</small>
              <strong dir="ltr">
                {number.replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)])}
              </strong>
            </span>
          </a>
          <button
            className="mini-phone-copy"
            type="button"
            aria-disabled={busy}
            aria-busy={busy}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              setMessage('');
              const copied = await copyMiniPhone(number);
              if (mounted.current) {
                setMessage(
                  copied
                    ? 'شماره تماس کپی شد.'
                    : 'کپی خودکار در دسترس نیست؛ شماره را نگه دارید، انتخاب و دستی کپی کنید.',
                );
                setBusy(false);
              }
            }}
          >
            <MiniIcon name="copy" />
            کپی شماره
          </button>
          {message && (
            <p className="mini-phone-status" role="status">
              {message}
            </p>
          )}
        </>
      ) : (
        <div className="mini-phone-unavailable">
          <span>شمارهٔ تماس هنوز ثبت نشده است.</span>
          <MiniLink href={`${base}/contact`}>اطلاعات فروشگاه</MiniLink>
        </div>
      )}
    </footer>
  );
}
