// Aggregations for the reports screen, pure so they can be unit tested.
export type InvoiceRow = { issuedAt: string; total: string | number; paidAmount?: string | number };
export type MonthlyBucket = { date: string; revenue: number; paid: number; invoiceCount: number };

const jalaliMonth = new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'long' });

/** Buckets invoices into Jalali months, oldest first, for the monthly sales chart. */
export function monthlySales(invoices: readonly InvoiceRow[]): MonthlyBucket[] {
  const buckets = new Map<string, MonthlyBucket & { key: number }>();
  for (const invoice of invoices) {
    const issued = new Date(invoice.issuedAt);
    if (Number.isNaN(issued.getTime())) continue;
    const key = issued.getFullYear() * 100 + issued.getMonth();
    const bucket = buckets.get(String(key)) ?? { key, date: jalaliMonth.format(issued), revenue: 0, paid: 0, invoiceCount: 0 };
    bucket.revenue += Math.max(0, Number(invoice.total) || 0);
    bucket.paid += Math.max(0, Number(invoice.paidAmount ?? 0) || 0);
    bucket.invoiceCount += 1;
    buckets.set(String(key), bucket);
  }
  return [...buckets.values()].sort((a, b) => a.key - b.key).map(({ key: _key, ...bucket }) => bucket);
}

/** Profit share per brand; negative margins are clamped so the donut stays readable. */
export function profitShare(brands: ReadonlyArray<{ brand: string; profit: string | number }>): Array<{ name: string; value: number }> {
  return brands
    .map((row) => ({ name: row.brand, value: Math.max(0, Math.round(Number(row.profit) || 0)) }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);
}
