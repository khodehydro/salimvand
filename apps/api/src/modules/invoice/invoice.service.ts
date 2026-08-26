import { Injectable } from '@nestjs/common';
import { calculateInvoiceTotals, InvoiceLineInput, InvoiceTotals } from './invoice.rules';
import { createPublicToken } from './public-token';

type DraftLine = InvoiceLineInput & { inventoryItemId: string; productName: string };
export type InvoiceDraft = InvoiceTotals & { number: string; publicToken: string; publicTokenHash: string; items: Array<DraftLine & { lineTotal: bigint }> };

@Injectable()
export class InvoiceService {
  buildDraft(number: string, lines: readonly DraftLine[], discount = 0n): InvoiceDraft {
    if (!/^INV-[0-9]{4,}$/.test(number)) throw new Error('شماره فاکتور معتبر نیست');
    if (lines.length === 0) throw new Error('فاکتور باید حداقل یک ردیف داشته باشد');
    if (lines.length > 100) throw new Error('تعداد ردیف‌های فاکتور بیش از حد مجاز است');
    const ids = new Set(lines.map((line) => line.inventoryItemId));
    if (ids.size !== lines.length) throw new Error('قلم موجودی نمی‌تواند در چند ردیف تکرار شود');
    if (lines.some((line) => !line.productName.trim())) throw new Error('نام محصول الزامی است');
    const totals = calculateInvoiceTotals(lines, discount);
    const publicToken = createPublicToken();
    return { ...totals, number, publicToken: publicToken.token, publicTokenHash: publicToken.hash, items: lines.map((line) => ({ ...line, lineTotal: BigInt(line.quantity) * line.unitPrice })) };
  }
}
