// Dashboard aggregates, kept pure so they can be unit tested without a DOM.
export type StockItem = {
  quantity: number;
  minStock?: number | null;
  brand?: { name: string } | null;
};

/** Share of each brand in the total stock; the long tail is merged into «سایر». */
export function brandComposition(
  items: StockItem[],
  top = 6,
): Array<{ name: string; value: number }> {
  const totals = new Map<string, number>();
  for (const item of items) {
    const name = item.brand?.name?.trim() || 'بدون برند';
    totals.set(name, (totals.get(name) ?? 0) + Math.max(0, item.quantity));
  }
  const sorted = [...totals.entries()].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
  const head = sorted.slice(0, top).map(([name, value]) => ({ name, value }));
  const rest = sorted.slice(top).reduce((sum, [, value]) => sum + value, 0);
  return rest > 0 ? [...head, { name: 'سایر برندها', value: rest }] : head;
}

/** Split of the shelf into out-of-stock, at/below threshold and healthy items. */
export function stockHealth(items: StockItem[]) {
  let out = 0;
  let low = 0;
  let healthy = 0;
  for (const item of items) {
    const quantity = Math.max(0, item.quantity);
    if (quantity <= 0) out += 1;
    else if (item.minStock != null && quantity <= item.minStock) low += 1;
    else healthy += 1;
  }
  return { out, low, healthy };
}

export function totalDebt(rows: Array<{ debt: string | number }>): number {
  return rows.reduce((sum, row) => sum + Math.max(0, Number(row.debt) || 0), 0);
}

/** SMS body for a debt reminder; keeps the placeholders the panel shows the operator. */
export function debtReminderMessage(customerName: string, debt: number, link?: string): string {
  const amount = new Intl.NumberFormat('fa-IR').format(Math.round(debt));
  return `${customerName} عزیز، ماندهٔ حساب شما نزد سلیم‌وند ${amount} ریال است. ${link ? `جزئیات: ${link}` : 'لطفاً برای تسویه هماهنگ کنید.'}`;
}
