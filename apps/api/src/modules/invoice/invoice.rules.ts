export type InvoiceLineInput = { quantity: number; unitPrice: bigint };
export type InvoiceTotals = { subtotal: bigint; discount: bigint; total: bigint };

export function calculateInvoiceTotals(
  lines: readonly InvoiceLineInput[],
  discount: bigint = 0n,
): InvoiceTotals {
  if (discount < 0n) throw new Error('تخفیف نمی‌تواند منفی باشد');
  const subtotal = lines.reduce((sum, line) => {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0)
      throw new Error('تعداد کالا باید عدد صحیح مثبت باشد');
    if (line.unitPrice < 0n) throw new Error('قیمت کالا نمی‌تواند منفی باشد');
    return sum + BigInt(line.quantity) * line.unitPrice;
  }, 0n);
  if (discount > subtotal) throw new Error('تخفیف نمی‌تواند از مبلغ فاکتور بیشتر باشد');
  return { subtotal, discount, total: subtotal - discount };
}
