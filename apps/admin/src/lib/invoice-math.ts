// Money rules for the invoice screen, kept free of React so they can be unit tested.
export type DraftLine = { salePrice: number; quantity: number; lineDiscount: number };
export type PaymentRow = { method: string; amount: string };

export const money = (value: string | number) => `${new Intl.NumberFormat('fa-IR').format(Math.round(Number(value) || 0))} ریال`;
export const persianNumber = (value: string | number) => new Intl.NumberFormat('fa-IR').format(Math.round(Number(value) || 0));

/** A line can never be discounted below zero, whatever the operator typed. */
export function lineTotal(salePrice: number, quantity: number, lineDiscount: number): number {
  const gross = Math.max(0, Number(salePrice) || 0) * Math.max(0, Math.max(1, Math.round(Number(quantity) || 1)));
  return Math.max(0, gross - Math.max(0, Number(lineDiscount) || 0));
}

export function invoiceTotals(lines: DraftLine[], discount: number) {
  const subtotal = lines.reduce((sum, line) => sum + lineTotal(line.salePrice, line.quantity, line.lineDiscount), 0);
  // A discount above the subtotal would silently flip the invoice negative.
  const discountValue = Math.min(Math.max(0, Number(discount) || 0), subtotal);
  return { subtotal, discount: discountValue, total: subtotal - discountValue };
}

export function paymentTotal(payments: PaymentRow[]): number {
  return payments.reduce((sum, row) => sum + Math.max(0, Math.round(Number(row.amount) || 0)), 0);
}

/** The invoice API accepts one unit price per line, so a line discount is folded in. */
export function discountedUnitPrice(salePrice: number, quantity: number, lineDiscount: number): string {
  const quantitySafe = Math.max(1, Math.round(Number(quantity) || 1));
  const price = Math.round((Number(salePrice) || 0) - (Math.max(0, Number(lineDiscount) || 0) / quantitySafe));
  return String(Math.max(0, price));
}

export function isValidIranMobile(mobile: string): boolean {
  return /^09\d{9}$/.test(mobile.trim());
}

/** What the customer still owes after the payments entered on screen. */
export function remainingDebt(total: number, payments: PaymentRow[]): number {
  return Math.max(0, total - paymentTotal(payments));
}
