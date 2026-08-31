import { useState } from 'react';
import { api } from '../lib/api';

/**
 * Inline stock stepper used in the product/inventory lists: just the number
 * with −/+ on either side. Every click saves instantly (optimistic update,
 * rollback on failure) through the inventory adjust endpoint, so counting
 * stock in and out no longer needs the separate adjustment form.
 */
export function StockStepper({
  itemId,
  quantity,
  onMessage,
  onSaved,
}: {
  itemId: string;
  quantity: number;
  onMessage?: (message: string) => void;
  onSaved?: () => void;
}) {
  const [value, setValue] = useState(quantity);
  const [busy, setBusy] = useState(false);

  const step = async (delta: number) => {
    if (busy || (delta < 0 && value + delta < 0)) return;
    const next = value + delta;
    setValue(next); // optimistic — feels instant, undone on failure
    setBusy(true);
    try {
      await api(`/inventory/items/${itemId}/adjust`, {
        method: 'POST',
        body: JSON.stringify({ quantity: delta, reason: 'اصلاح سریع موجودی از لیست' }),
      });
      onSaved?.();
    } catch (error) {
      setValue(value);
      onMessage?.((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="stock-stepper" dir="ltr">
      <button
        type="button"
        aria-label="کاهش موجودی"
        disabled={busy || value <= 0}
        onClick={() => void step(-1)}
      >
        −
      </button>
      <b className={value <= 0 ? 'empty' : undefined}>{value}</b>
      <button type="button" aria-label="افزایش موجودی" disabled={busy} onClick={() => void step(1)}>
        +
      </button>
    </span>
  );
}
