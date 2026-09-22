import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  discountedUnitPrice,
  invoiceTotals,
  isValidIranMobile,
  lineRemaining,
  money,
  netInvoiceAmount,
  paymentTotal as sumPayments,
  persianNumber,
  remainingDebt as debtLeft,
  type PaymentRow,
} from '../lib/invoice-math';
import { api, downloadFile, fetchAllPages } from '../lib/api';
import { publicSiteUrl } from '../lib/public-site';
import { paramsFromHash } from '../lib/admin-route';
import { formatPersianNumber } from '@salimvand/shared';
import { FaNumberInput } from '../components/FaNumberInput';
import { JalaliDateInput } from '../components/JalaliDateInput';

type Invoice = {
  id: string;
  number: string;
  customerName?: string | null;
  customerMobile?: string | null;
  storeAddress?: string | null;
  storePhone?: string | null;
  customerAddress?: string | null;
  subtotal: string;
  discount: string;
  total: string;
  /** Sum of every return's refundAmount (serialized BigInt). */
  returnedTotal?: string;
  /** total - returnedTotal: what the customer effectively owes. */
  netTotal?: string;
  paidAmount: string;
  paymentStatus: string;
  status: string;
  issuedAt: string;
  /** Archive rows are paginated summaries — line data only arrives with the
   * detail view (fetchInvoiceDetail). */
  items?: InvoiceItemRow[];
  /** Line count on summary rows; avoids loading every line of every invoice. */
  itemCount?: number;
  returns?: ReturnRow[];
};
type StockOption = {
  id: string;
  barcode: string;
  quantity: number;
  salePrice: string;
  location?: { code: string; name: string } | null;
  product: { name: string; code: string };
  brand: { name: string };
};
type CustomerOption = {
  id: string;
  name: string;
  mobile: string;
  address?: string | null;
  debt?: string | number;
  invoiceCount?: number;
};
type InvoiceItemRow = {
  id: string;
  productName: string;
  quantity: number;
  returnedQuantity?: number;
  unitPrice: string;
  lineTotal: string;
  inventoryItem?: { brand: { name: string } } | null;
};
type ReturnRow = {
  id: string;
  invoiceItemId: string;
  quantity: number;
  refundAmount: string;
  reason: string;
  restock: boolean;
  createdAt: string;
};
type DraftLine = {
  item: StockOption;
  quantity: number;
  lineDiscount: number;
  /** Editable unit price — starts at the stock option's sale price. */
  price: number;
};
type CreatedInvoice = {
  id: string;
  number: string;
  publicToken: string;
  publicShortCode: string;
  total: number;
  paid: number;
  itemCount: number;
  qrDataUrl?: string;
};

const methods = [
  { value: 'cash', label: 'نقدی' },
  { value: 'card', label: 'کارت‌خوان' },
  { value: 'transfer', label: 'واریز بانکی' },
  { value: 'credit', label: 'نسیه / چک' },
];
const labels: Record<string, string> = {
  paid: 'پرداخت کامل',
  partial: 'پرداخت بخشی',
  unpaid: 'پرداخت‌نشده',
  issued: 'صادرشده',
  voided: 'باطل‌شده',
};
const shortLink = (code: string) => `${publicSiteUrl}/i/${code}`;

export function InvoicesPage({
  canCreate = true,
  canPay = true,
  canResend = true,
  canVoid = false,
}: {
  canCreate?: boolean;
  canPay?: boolean;
  canResend?: boolean;
  canVoid?: boolean;
}) {
  const [rows, setRows] = useState<Invoice[]>([]);
  const [options, setOptions] = useState<StockOption[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [search, setSearch] = useState('');
  /** The customer picked from the lookup — drives the customer bar chip. */
  const [pickedCustomer, setPickedCustomer] = useState<CustomerOption | null>(null);
  const [customerQuery, setCustomerQuery] = useState('');
  /** True once the debounced lookup finished with zero matches — drives the
   * "will be issued as a walk-in" hint under the name/mobile inputs. */
  const [noCustomerMatch, setNoCustomerMatch] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [mobile, setMobile] = useState('');
  const [discount, setDiscount] = useState('');
  const [payments, setPayments] = useState<PaymentRow[]>([{ method: 'cash', amount: '' }]);
  const [checksDraft, setChecksDraft] = useState([
    { checkNumber: '', bank: '', branch: '', dueDate: '', amount: '' },
  ]);
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [viewing, setViewing] = useState<Invoice | null>(null);
  // Public-link dialog: shows the short tokenized link for one invoice.
  const [linkFor, setLinkFor] = useState<Invoice | null>(null);
  const [linkInfo, setLinkInfo] = useState<{
    shortCode: string;
    token: string;
    expiresAt: string | null;
    qrDataUrl?: string;
  } | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'paid' | 'partial' | 'unpaid'>('all');
  // Jalali date-range filter — JalaliDateInput hands back Gregorian yyyy-mm-dd.
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [invoiceQuery, setInvoiceQuery] = useState('');
  const [created, setCreated] = useState<CreatedInvoice | null>(null);
  // Two tabs: issuing lives apart from the issued-invoices register so sellers
  // can work the POS flow and the archive independently.
  const [tab, setTab] = useState<'issue' | 'list'>(canCreate ? 'issue' : 'list');
  // Addresses on the invoice (store snapshot + customer), editable later.
  // Read-only store contact block from settings (issue-form hint).
  const [storeAddress, setStoreAddress] = useState('');
  const [storePhone, setStorePhone] = useState('');
  const [storeLogoUrl, setStoreLogoUrl] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [addressDraft, setAddressDraft] = useState({ store: '', phone: '', customer: '' });
  const [addressBusy, setAddressBusy] = useState(false);
  // Partial return dialog: one invoice line, qty 1..remaining, reason and a
  // restock switch (damaged goods stay out of sellable stock).
  const [returnLine, setReturnLine] = useState<{ invoice: Invoice; item: InvoiceItemRow } | null>(
    null,
  );
  const [returnQty, setReturnQty] = useState('1');
  const [returnReason, setReturnReason] = useState('');
  const [returnRestock, setReturnRestock] = useState(true);
  const [returnBusy, setReturnBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [scanning, setScanning] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const load = () =>
    // The archive endpoint is cursor-paginated (summaries only); drain the
    // pages so client-side search across the whole history keeps working.
    fetchAllPages<Invoice>('/invoices', { limit: 200 })
      .then((data) => {
        setRows(data);
        return data;
      })
      .catch((error: Error) => {
        setMessage(error.message);
        return [] as Invoice[];
      });

  // The public link is stored hashed and is short + random — the invoice
  // number never appears in it, so no customer can reach another invoice by
  // editing the code. Issuing a new link invalidates the previous one and it
  // stays valid for 30 days.
  const issueLink = async (invoice: Invoice) => {
    setLinkBusy(true);
    setLinkInfo(null);
    try {
      const result = await api<{
        data: { publicToken: string; publicShortCode: string; linkExpiresAt: string | null };
      }>(`/invoices/${invoice.id}/link`, { method: 'POST' });
      const info = {
        shortCode: result.data.publicShortCode,
        token: result.data.publicToken,
        expiresAt: result.data.linkExpiresAt,
      };
      try {
        const qr = await api<{ data: { dataUrl: string } }>(
          `/public/invoices/qr/${info.shortCode}`,
        );
        setLinkInfo({ ...info, qrDataUrl: qr.data.dataUrl });
      } catch {
        setLinkInfo(info); // QR is a bonus; the link works without it.
      }
    } catch (error) {
      setMessage((error as Error).message);
      setLinkFor(null);
    } finally {
      setLinkBusy(false);
    }
  };

  const copyInvoiceLink = () => {
    if (!linkInfo) return;
    void navigator.clipboard?.writeText(shortLink(linkInfo.shortCode));
    setMessage('لینک فاکتور کپی شد');
  };

  const downloadInvoicePdf = (invoice: Invoice) =>
    downloadFile(`/invoices/${invoice.id}/pdf`, `invoice-${invoice.number}.pdf`).catch(
      (error: Error) => setMessage(error.message),
    );
  // Deep link from the global palette (#/invoices?invoice=<id>) opens the details.
  useEffect(() => {
    const openFromHash = () => {
      const invoiceId = paramsFromHash(window.location.hash).invoice;
      if (!invoiceId) return;
      const match = rows.find((row) => row.id === invoiceId);
      if (match) openViewing(match);
      else
        void fetchAllPages<Invoice>('/invoices', { limit: 200 })
          .then((data) => {
            setRows(data);
            const found = data.find((row) => row.id === invoiceId);
            if (found) openViewing(found);
          })
          .catch(() => undefined);
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  useEffect(() => {
    void load();
    if (canCreate)
      void api<{
        data: StockOption[];
        storeAddress?: string;
        storePhone?: string;
        storeLogoUrl?: string;
      }>('/invoices/options')
        .then((result) => {
          setOptions(result.data);
          // Store contact block from settings — shown read-only in the issue
          // form; the server snapshots it onto the invoice automatically.
          if (result.storeAddress) setStoreAddress(result.storeAddress);
          if (result.storePhone) setStorePhone(result.storePhone);
          if (result.storeLogoUrl) setStoreLogoUrl(result.storeLogoUrl);
        })
        .catch((error: Error) => setMessage(error.message));
  }, [canCreate]);

  // Customer lookup is debounced: typing a mobile must not fire a request per key.
  // The query comes from the NAME/MOBILE inputs themselves — typing there
  // suggests existing customers; no separate search box is needed.
  useEffect(() => {
    const query = customerQuery.trim();
    if (!canCreate || query.length < 2) {
      setCustomers([]);
      setNoCustomerMatch(false);
      return;
    }
    const handle = window.setTimeout(() => {
      void api<{ data: CustomerOption[] }>(`/customers?search=${encodeURIComponent(query)}`)
        .then((result) => {
          setCustomers(result.data);
          setNoCustomerMatch(result.data.length === 0);
        })
        .catch(() => {
          setCustomers([]);
          setNoCustomerMatch(false);
        });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [canCreate, customerQuery]);

  const candidates = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return options
      .filter(
        (item) =>
          item.quantity > 0 &&
          !lines.some((line) => line.item.id === item.id) &&
          (!query ||
            `${item.product.name} ${item.product.code} ${item.barcode} ${item.brand.name}`
              .toLocaleLowerCase()
              .includes(query)),
      )
      .slice(0, 12);
  }, [options, search, lines]);

  /** Scan results grouped per product; each brand under it is a pickable row. */
  const candidateGroups = useMemo(() => {
    const groups: Array<{ key: string; name: string; code: string; brands: StockOption[] }> = [];
    for (const option of candidates) {
      const key = `${option.product.code}::${option.product.name}`;
      const group = groups.find((entry) => entry.key === key);
      if (group) group.brands.push(option);
      else
        groups.push({
          key,
          name: option.product.name,
          code: option.product.code,
          brands: [option],
        });
    }
    return groups;
  }, [candidates]);

  const lineTotal = (line: DraftLine) =>
    invoiceTotals([{ salePrice: line.price, quantity: line.quantity, lineDiscount: 0 }], 0).total;
  const discountPercent = Math.min(100, Math.max(0, Number(discount) || 0));
  const grossSubtotal = lines.reduce(
    (sum, line) => sum + Math.max(0, line.price) * Math.max(1, line.quantity),
    0,
  );
  const discountAmount = Math.round((grossSubtotal * discountPercent) / 100);
  const {
    subtotal,
    discount: discountValue,
    total,
  } = invoiceTotals(
    lines.map((line) => ({ salePrice: line.price, quantity: line.quantity, lineDiscount: 0 })),
    discountAmount,
  );
  const paymentTotal = sumPayments(payments);
  const remainingDebt = debtLeft(total, payments);

  const addLine = (item: StockOption, qty = 1) => {
    if (!Number.isInteger(qty) || qty <= 0) return setMessage('تعداد باید عدد صحیح مثبت باشد');
    const existing = lines.find((line) => line.item.id === item.id);
    const nextQty = (existing?.quantity ?? 0) + qty;
    if (nextQty > item.quantity)
      return setMessage(
        `موجودی ${item.product.name} فقط ${formatPersianNumber(item.quantity)} عدد است`,
      );
    setLines((current) =>
      existing
        ? current.map((line) => (line.item.id === item.id ? { ...line, quantity: nextQty } : line))
        : [...current, { item, quantity: qty, lineDiscount: 0, price: Number(item.salePrice) }],
    );
    setSearch('');
    setMessage('');
  };

  const setLine = (id: string, patch: Partial<DraftLine>) =>
    setLines((current) =>
      current.map((line) => (line.item.id === id ? { ...line, ...patch } : line)),
    );

  /** «پاک کردن» — wipes the whole draft (customer, lines, payments). */
  const resetForm = () => {
    setLines([]);
    setSearch('');
    setPickedCustomer(null);
    setCustomerName('');
    setMobile('');
    setCustomerQuery('');
    setCustomerAddress('');
    setDiscount('');
    setPayments([{ method: 'cash', amount: '' }]);
    setMessage('');
    searchRef.current?.focus();
  };

  // A barcode gun types the code and then sends Enter: resolve it without a click.
  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const exact = options.find((item) => item.barcode === search.trim());
    if (exact) return addLine(exact, 1);
    if (candidates.length === 1) return addLine(candidates[0], 1);
    setMessage(
      candidates.length
        ? 'چند قلم پیدا شد؛ یکی را انتخاب کنید.'
        : 'قلمی با این نام یا بارکد پیدا نشد.',
    );
  };

  const onScanned = async (code: string) => {
    setScanning(false);
    const exact = options.find((item) => item.barcode === code.trim());
    if (!exact) return setMessage(`بارکد ${code} در موجودی ثبت نشده است`);
    addLine(exact, 1);
  };

  const create = async () => {
    if (!lines.length) return setMessage('حداقل یک قلم برای فاکتور انتخاب کنید');
    if (lines.some((line) => !Number.isFinite(line.price) || line.price <= 0))
      return setMessage('قیمت واحد همهٔ اقلام باید بیشتر از صفر باشد');
    if (discountValue > subtotal) return setMessage('تخفیف نمی‌تواند از جمع اقلام بیشتر باشد');
    if (paymentTotal > total) return setMessage('مجموع دریافتی از مبلغ فاکتور بیشتر است');
    if (mobile && !isValidIranMobile(mobile))
      return setMessage('شماره موبایل باید با ۰۹ شروع شود و ۱۱ رقم باشد');
    try {
      const response = await api<{
        data: { id: string; number: string; publicToken: string; publicShortCode: string };
      }>('/invoices', {
        method: 'POST',
        body: JSON.stringify({
          customerName: customerName || undefined,
          customerMobile: mobile || undefined,
          // Store address/phone are NOT sent: the server snapshots them from
          // the settings store profile on its own.
          customerAddress: customerAddress.trim() || undefined,
          discount: discountValue,
          items: lines.map((line) => ({
            inventoryItemId: line.item.id,
            quantity: line.quantity,
            // Per-line price edits and discounts are folded into the unit
            // price, the only money field the API accepts.
            unitPrice: discountedUnitPrice(line.price, line.quantity, line.lineDiscount),
          })),
        }),
      });
      for (const row of payments) {
        const amount = Math.round(Number(row.amount) || 0);
        if (amount <= 0) continue;
        await api(`/invoices/${response.data.id}/pay`, {
          method: 'POST',
          body: JSON.stringify({
            amount: String(amount),
            method: row.method,
            ...(row.method === 'credit'
              ? {
                  checks: checksDraft.map((check) => ({
                    ...check,
                    amount: check.amount || String(amount),
                  })),
                }
              : {}),
          }),
        });
      }
      const qr = await api<{ data: { dataUrl: string } }>(
        `/public/invoices/qr/${response.data.publicShortCode}`,
      ).catch(() => ({ data: { dataUrl: '' } }));
      setCreated({
        id: response.data.id,
        number: response.data.number,
        publicToken: response.data.publicToken,
        publicShortCode: response.data.publicShortCode,
        total,
        paid: paymentTotal,
        itemCount: lines.length,
        qrDataUrl: qr.data.dataUrl,
      });
      setMessage('فاکتور صادر شد و موجودی به‌صورت اتمیک در Ledger ثبت شد.');
      setLines([]);
      setPickedCustomer(null);
      setCustomerName('');
      setMobile('');
      setCustomerQuery('');
      setCustomerAddress('');
      setDiscount('');
      setPayments([{ method: 'cash', amount: '' }]);
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const pay = async () => {
    if (!paying || !payAmountValid()) return;
    try {
      for (const row of payments) {
        const amount = Math.round(Number(row.amount) || 0);
        if (amount <= 0) continue;
        await api(`/invoices/${paying.id}/pay`, {
          method: 'POST',
          body: JSON.stringify({
            amount: String(amount),
            method: row.method,
            ...(row.method === 'credit'
              ? {
                  checks: checksDraft.map((check) => ({
                    ...check,
                    amount: check.amount || String(amount),
                  })),
                }
              : {}),
          }),
        });
      }
      setMessage('پرداخت ثبت و در Audit Log نوشته شد.');
      setPaying(null);
      setPayments([{ method: 'cash', amount: '' }]);
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  const payAmountValid = () => payments.some((row) => Number(row.amount) > 0);

  /** Opens the invoice detail modal with a fresh address draft. */
  /** Archive rows are summaries; the detail view (lines + returns + per-line
   * returnedQuantity) is fetched on demand and cached onto the row. */
  const fetchInvoiceDetail = (invoice: Invoice): Promise<Invoice | null> =>
    api<{ data: Invoice }>(`/invoices/${invoice.id}`)
      .then((result) => {
        const detail = result.data;
        const returnedPerLine = new Map<string, number>();
        let returnedTotal = 0;
        for (const record of detail.returns ?? []) {
          returnedPerLine.set(
            record.invoiceItemId,
            (returnedPerLine.get(record.invoiceItemId) ?? 0) + record.quantity,
          );
          returnedTotal += Number(record.refundAmount);
        }
        return {
          ...detail,
          itemCount: detail.items?.length ?? 0,
          returnedTotal: String(returnedTotal),
          netTotal: String(Number(detail.total) - returnedTotal),
          items: (detail.items ?? []).map((item) => ({
            ...item,
            returnedQuantity: returnedPerLine.get(item.id) ?? 0,
          })),
        };
      })
      .catch(() => null);

  const openViewing = (invoice: Invoice) => {
    setViewing(invoice);
    setAddressDraft({
      store: invoice.storeAddress ?? '',
      phone: invoice.storePhone ?? '',
      customer: invoice.customerAddress ?? '',
    });
    void fetchInvoiceDetail(invoice).then((detail) => {
      // Only upgrade the modal if the user is still on this invoice.
      setViewing((current) => (current && current.id === invoice.id && detail ? detail : current));
    });
  };

  /** Addresses stay editable after issue (store snapshot / customer address). */
  const saveAddresses = async () => {
    if (!viewing) return;
    setAddressBusy(true);
    try {
      await api(`/invoices/${viewing.id}/addresses`, {
        method: 'PATCH',
        body: JSON.stringify({
          storeAddress: addressDraft.store,
          storePhone: addressDraft.phone,
          customerAddress: addressDraft.customer,
        }),
      });
      setMessage(`آدرس‌های فاکتور ${formatPersianNumber(viewing.number)} ذخیره شد.`);
      await load();
      // The archive row is a summary — refresh the open modal from the detail.
      const detail = await fetchInvoiceDetail(viewing);
      if (detail) setViewing(detail);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setAddressBusy(false);
    }
  };

  /** Partial return of ONE line: 1 of 3 brake pads can go back while 2 stay. */
  const openReturn = (invoice: Invoice, item: InvoiceItemRow) => {
    const remaining = lineRemaining(item.quantity, item.returnedQuantity);
    if (invoice.status === 'voided') return setMessage('فاکتور باطل‌شده قابل مرجوعی نیست');
    if (remaining <= 0) return setMessage('این قلم کاملاً برگشت خورده است');
    setReturnLine({ invoice, item });
    setReturnQty('1');
    setReturnReason('');
    setReturnRestock(true);
  };

  const printReturnReceipt = (
    invoice: Invoice,
    item: InvoiceItemRow,
    quantity: number,
    reason: string,
    restock: boolean,
  ) => {
    const win = window.open('', '_blank', 'width=800,height=700');
    if (!win) return;
    const date = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'full', timeStyle: 'short' }).format(
      new Date(),
    );
    win.document.write(
      `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>رسید مرجوعی ${invoice.number}</title><style>body{font-family:Vazirmatn,Tahoma,sans-serif;color:#17243b;padding:28px;max-width:760px;margin:auto}.head{display:flex;justify-content:space-between;border-bottom:3px solid #173b63;padding-bottom:14px}.brand{font-size:21px;font-weight:800;color:#173b63}h1{font-size:19px;margin:28px 0 8px}.meta{color:#64748b;font-size:11px;margin-bottom:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccd5df;padding:10px;text-align:right}th{background:#edf2f7}.note{margin-top:20px;padding:12px;background:#f5f8fb;border-radius:8px;font-size:12px}.sign{display:flex;justify-content:space-between;margin-top:70px;font-size:11px;color:#64748b}@media print{body{padding:0}}</style></head><body><div class="head"><span class="brand">فروشگاه سلیم وند</span><span>رسید مرجوعی کالا</span></div><h1>رسید مرجوعی فاکتور ${invoice.number}</h1><div class="meta">مشتری: ${invoice.customerName ?? 'حضوری'} · تاریخ ثبت: ${date}</div><table><thead><tr><th>محصول</th><th>تعداد</th><th>مبلغ برگشت</th><th>مقصد کالا</th></tr></thead><tbody><tr><td>${item.productName}</td><td>${quantity}</td><td>${money(Number(item.unitPrice) * quantity)}</td><td>${restock ? 'بازگشت به انبار' : 'ضایعات'}</td></tr></tbody></table><div class="note"><b>دلیل مرجوعی:</b> ${reason}</div><div class="sign"><span>امضای مشتری</span><span>امضای فروشگاه</span></div><script>window.onload=()=>setTimeout(()=>window.print(),250)</script></body></html>`,
    );
    win.document.close();
  };

  const submitReturn = async () => {
    if (!returnLine) return;
    const remaining = lineRemaining(returnLine.item.quantity, returnLine.item.returnedQuantity);
    const qty = Number(returnQty);
    const reason = returnReason.trim();
    if (!Number.isInteger(qty) || qty <= 0 || qty > remaining)
      return setMessage(`تعداد برگشت باید بین ۱ تا ${formatPersianNumber(remaining)} باشد`);
    if (!reason) return setMessage('دلیل مرجوعی الزامی است');
    setReturnBusy(true);
    try {
      await api(`/invoices/${returnLine.invoice.id}/returns`, {
        method: 'POST',
        body: JSON.stringify({
          invoiceItemId: returnLine.item.id,
          quantity: qty,
          reason,
          restock: returnRestock,
        }),
      });
      printReturnReceipt(returnLine.invoice, returnLine.item, qty, reason, returnRestock);
      setMessage(
        `${qty} عدد «${returnLine.item.productName}» برگشت خورده شد؛ مبلغ فاکتور کم شد${
          returnRestock ? ' و قطعه به دارایی انبار برگشت' : ' (خراب — به انبار برنگشت)'
        }.`,
      );
      const updated = await load();
      // Refresh the open modal with fresh line data (the list row is a summary).
      const refreshed = updated.find((row) => row.id === returnLine.invoice.id);
      if (viewing && refreshed) {
        const detail = await fetchInvoiceDetail(refreshed);
        if (detail) setViewing(detail);
      }
      setReturnLine(null);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setReturnBusy(false);
    }
  };

  // Resending rotates the short link, so the operator gets the new URL to hand over.
  const resend = async (invoice: Invoice) => {
    const mobile = window.prompt('شمارهٔ موبایل گیرنده (خالی = شمارهٔ ثبت‌شدهٔ فاکتور)') ?? '';
    try {
      const result = await api<{ data: { publicShortCode: string } }>(
        `/invoices/${invoice.id}/resend-sms`,
        { method: 'POST', body: JSON.stringify(mobile ? { mobile } : {}) },
      );
      const link = shortLink(result.data.publicShortCode);
      setMessage(
        `پیامک فاکتور ${formatPersianNumber(invoice.number)} در صف ارسال قرار گرفت. لینک جدید: ${link}`,
      );
      void navigator.clipboard?.writeText(link);
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  // The archive is searchable the moment you type — number, name or mobile —
  // and narrows by a Jalali date range (whole days, inclusive).
  const filteredRows = useMemo(() => {
    const query = invoiceQuery.trim().toLocaleLowerCase();
    const fromTime = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const toTime = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;
    return rows
      .filter((invoice) => statusFilter === 'all' || invoice.paymentStatus === statusFilter)
      .filter((invoice) => {
        if (fromTime == null && toTime == null) return true;
        const issued = new Date(invoice.issuedAt).getTime();
        return (fromTime == null || issued >= fromTime) && (toTime == null || issued <= toTime);
      })
      .filter(
        (invoice) =>
          !query ||
          `${invoice.number} ${invoice.customerName ?? ''} ${invoice.customerMobile ?? ''}`
            .toLocaleLowerCase()
            .includes(query),
      );
  }, [rows, statusFilter, invoiceQuery, dateFrom, dateTo]);

  const net = (invoice: Invoice) => netInvoiceAmount(invoice.total, invoice.netTotal);
  const returnedOf = (invoice: Invoice) => Number(invoice.returnedTotal ?? 0);

  /** Shamsi date + HH:mm for the list column — Persian digits via fa-IR. */
  const jalaliDateTime = (iso: string) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return { date: '—', time: '' };
    return {
      date: date.toLocaleDateString('fa-IR'),
      time: date.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }),
    };
  };

  return (
    <section className="invoices-page">
      <div className="page-title">
        <div>
          <h1 className="invoice-page-heading">
            {storeLogoUrl && <img src={storeLogoUrl} alt="فروشگاه سلیم‌وند" />}فروش و فاکتورها
          </h1>
          <p className="muted">
            {tab === 'issue'
              ? 'صدور فاکتور چندقلمی با اسکنر، مصرف اتمیک موجودی و پرداخت چندروشه'
              : 'جست‌وجوی فاکتور، مشاهده، لینک امن و ثبت برگشت جزیی اقلام'}
          </p>
        </div>
        <span className="count">{persianNumber(rows.length)} فاکتور</span>
      </div>

      <nav className="settings-tabs" aria-label="بخش‌های فروش">
        {canCreate && (
          <button
            type="button"
            className={tab === 'issue' ? 'active' : ''}
            onClick={() => setTab('issue')}
            aria-current={tab === 'issue' ? 'true' : undefined}
          >
            <b>صدور فاکتور</b>
            <small>ثبت فروش جدید با بارکدخوان و پرداخت چندروشه</small>
          </button>
        )}
        <button
          type="button"
          className={tab === 'list' ? 'active' : ''}
          onClick={() => setTab('list')}
          aria-current={tab === 'list' ? 'true' : undefined}
        >
          <b>فاکتورهای صادر شده</b>
          <small>آرشیو، جست‌وجو، برگشت جزیی اقلام و لینک امن</small>
        </button>
      </nav>

      {message && <div className="notice">{message}</div>}

      {created && (
        <div className="modal-mask" role="dialog" aria-modal="true" aria-label="فاکتور صادر شد">
          <div className="modal-mask-panel success-modal">
            <div className="success-box">
              <span className="ok">✓</span>
              <h2>فاکتور صادر شد</h2>
              <p className="muted">
                شمارهٔ فاکتور <b className="mono">{formatPersianNumber(created.number)}</b>
              </p>
              <div className="kv">
                <span className="k">مبلغ</span>
                <span className="v">{money(created.total)}</span>
              </div>
              <div className="kv">
                <span className="k">دریافتی</span>
                <span className="v">{money(created.paid)}</span>
              </div>
              {created.total - created.paid > 0 && (
                <div className="kv">
                  <span className="k">باقی‌مانده (بدهی)</span>
                  <span className="v warn-text">{money(created.total - created.paid)}</span>
                </div>
              )}
              <div className="kv">
                <span className="k">کسر از انبار</span>
                <span className="v">
                  {persianNumber(created.itemCount)} ردیف · ثبت در دفتر تراکنش‌ها ✓
                </span>
              </div>
              {created.qrDataUrl ? (
                <img className="success-qr" src={created.qrDataUrl} alt="QR فاکتور" />
              ) : null}
              <input
                className="success-link"
                readOnly
                dir="ltr"
                value={shortLink(created.publicShortCode)}
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
            <div className="success-actions">
              <button
                className="button-primary"
                onClick={() => {
                  setCreated(null);
                  searchRef.current?.focus();
                }}
              >
                فاکتور بعدی
              </button>
              <button
                className="outline"
                onClick={() =>
                  downloadFile(
                    `/invoices/${created.id}/pdf`,
                    `invoice-${created.number}.pdf`,
                  ).catch((error: Error) => setMessage(error.message))
                }
              >
                دانلود PDF
              </button>
              <button
                className="outline"
                onClick={() =>
                  void navigator.clipboard?.writeText(shortLink(created.publicShortCode))
                }
              >
                کپی لینک
              </button>
              <a
                className="outline"
                target="_blank"
                rel="noreferrer"
                href={shortLink(created.publicShortCode)}
              >
                مشاهده
              </a>
            </div>
          </div>
        </div>
      )}

      {tab === 'issue' && canCreate && (
        <div className="inv-issue">
          {/* Customer bar: picked-customer chip or inline walk-in fields */}
          <div className="cust-bar">
            <span className="lab">مشتری</span>
            {pickedCustomer ? (
              <div className="cust">
                <span className="av">{pickedCustomer.name.slice(0, 2)}</span>
                <div className="wrap">
                  <div className="nm">{pickedCustomer.name}</div>
                  <div className="sub">
                    <span className="mono" dir="ltr">
                      {pickedCustomer.mobile}
                    </span>
                    {Number(pickedCustomer.debt ?? 0) > 0 && (
                      <span className="danger-text">بدهی: {money(pickedCustomer.debt ?? 0)}</span>
                    )}
                    {typeof pickedCustomer.invoiceCount === 'number' &&
                      pickedCustomer.invoiceCount > 0 && (
                        <span>{persianNumber(pickedCustomer.invoiceCount)} فاکتور قبلی</span>
                      )}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-ghost-sm"
                  title="جداسازی مشتری"
                  onClick={() => {
                    setPickedCustomer(null);
                    setCustomerName('');
                    setMobile('');
                    setCustomerQuery('');
                    setCustomerAddress('');
                  }}
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="cust-empty-wrap">
                <div className="cust-empty">
                  <input
                    aria-label="نام مشتری"
                    placeholder="نام مشتری (انتخاب از لیست یا تایپ جدید)…"
                    autoComplete="off"
                    value={customerName}
                    onChange={(event) => {
                      setCustomerName(event.target.value);
                      setCustomerQuery(event.target.value);
                    }}
                  />
                  <input
                    aria-label="موبایل مشتری"
                    dir="ltr"
                    placeholder="09xxxxxxxxx"
                    autoComplete="off"
                    value={mobile}
                    onChange={(event) => {
                      setMobile(event.target.value);
                      setCustomerQuery(event.target.value);
                    }}
                  />
                </div>
                {!pickedCustomer && customerQuery.trim().length >= 2 && customers.length > 0 && (
                  <div className="invoice-candidates cust-candidates">
                    {customers.map((customer) => (
                      <button
                        type="button"
                        key={customer.id}
                        onClick={() => {
                          setPickedCustomer(customer);
                          setCustomerName(customer.name);
                          setMobile(customer.mobile);
                          setCustomerAddress(customer.address ?? '');
                          setCustomerQuery('');
                          setCustomers([]);
                          setNoCustomerMatch(false);
                        }}
                      >
                        <b>{customer.name}</b>
                        <span>
                          <span dir="ltr">{formatPersianNumber(customer.mobile)}</span> · بدهی{' '}
                          {money(customer.debt ?? 0)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {!pickedCustomer && noCustomerMatch && (
                  <small className="walkin-hint">
                    مشتری ثبت‌شده‌ای با این مشخصات نیست؛ فاکتور با همین نام به‌صورت حضوری صادر
                    می‌شود.
                  </small>
                )}
              </div>
            )}
            <a className="btn-soft-sm" href="#/customers">
              + مشتری جدید
            </a>
          </div>

          {/* Store contact (auto from settings) + customer address */}
          <div className="cust-extra">
            <div className="plc-chips">
              {storeAddress && <span className="chip">{storeAddress}</span>}
              {storePhone && (
                <span className="chip" dir="ltr">
                  {storePhone}
                </span>
              )}
              {!storeAddress && !storePhone && (
                <span className="muted">
                  آدرس و تماس فروشگاه از تنظیمات («پروفایل فروشگاه») روی فاکتور درج می‌شود.
                </span>
              )}
            </div>
            <input
              aria-label="آدرس مشتری"
              placeholder="آدرس مشتری (اختیاری — با انتخاب مشتری از پرونده‌اش پر می‌شود)"
              value={customerAddress}
              onChange={(event) => setCustomerAddress(event.target.value)}
            />
          </div>

          <div className="inv-grid">
            <div className="inv-grid-main">
              {/* Scanner box: type/scan + brand-level results */}
              <div className={`scan-box${search || scanning ? ' has-res' : ''}`}>
                <div className="scan-in">
                  <div className="search-field scan-field">
                    <span className="search-icon">⌕</span>
                    <input
                      ref={searchRef}
                      aria-label="جست‌وجو یا اسکن قلم"
                      placeholder="جست‌وجوی قطعه یا اسکن بارکد (Enter = اسکن)…"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      onKeyDown={onSearchKeyDown}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn-o-sm"
                    onClick={() => setScanning((current) => !current)}
                    title="اسکن با دوربین"
                  >
                    📷
                  </button>
                  <span className="badge b-line">بارکدخوان آماده</span>
                </div>
                {scanning && <BarcodeHost onCode={(code) => void onScanned(code)} />}
                {search && !scanning && (
                  <div className="scan-res">
                    {candidateGroups.length ? (
                      candidateGroups.map((group) => (
                        <div className="sr" key={group.key}>
                          <span className="thumb">{group.name.slice(0, 2)}</span>
                          <div className="wrap">
                            <div className="nm">
                              {group.name} <span className="badge b-brand">{group.code}</span>
                            </div>
                            <div className="brs">
                              {group.brands.map((option) => (
                                <button
                                  type="button"
                                  className="br"
                                  key={option.id}
                                  onClick={() => addLine(option)}
                                >
                                  {option.brand.name} <b>{money(option.salePrice)}</b>{' '}
                                  <span className="mut3">
                                    {option.location?.code ?? '—'} ·{' '}
                                    {persianNumber(option.quantity)} عدد
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="val">
                            <span className="badge b-ok">موجود</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="muted scan-empty">قلم موجودی پیدا نشد.</p>
                    )}
                  </div>
                )}
              </div>

              {/* Invoice lines */}
              <div className="rows">
                <div className="irow hd">
                  <div>محصول / قفسه</div>
                  <div>برند</div>
                  <div>تعداد</div>
                  <div className="hd-hide num price-column-title">قیمت واحد (قابل ویرایش)</div>
                  <div className="num">مبلغ نهایی</div>
                  <div />
                </div>
                {lines.length ? (
                  lines.map((line) => (
                    <div className="irow" key={line.item.id}>
                      <div>
                        <div className="pn">{line.item.product.name}</div>
                        <div className="ps">
                          {line.item.product.code} · {line.item.location?.code ?? '—'}
                        </div>
                      </div>
                      <div>
                        <span className="badge b-brand">{line.item.brand.name}</span>
                      </div>
                      <div className="qty">
                        <button
                          type="button"
                          aria-label={`کاهش ${line.item.product.name}`}
                          onClick={() =>
                            setLine(line.item.id, {
                              quantity: Math.max(1, line.quantity - 1),
                            })
                          }
                        >
                          −
                        </button>
                        <span>{persianNumber(line.quantity)}</span>
                        <button
                          type="button"
                          aria-label={`افزایش ${line.item.product.name}`}
                          disabled={line.quantity >= line.item.quantity}
                          onClick={() =>
                            setLine(line.item.id, {
                              quantity: Math.min(line.item.quantity, line.quantity + 1),
                            })
                          }
                        >
                          +
                        </button>
                      </div>
                      <FaNumberInput
                        className="money-in hd-hide invoice-price-input"
                        aria-label={`قیمت واحد قابل ویرایش ${line.item.product.name}`}
                        title="قیمت پیش‌فرض از انبار آمده است؛ در صورت نیاز آن را تغییر دهید."
                        value={String(line.price)}
                        onChange={(plain) =>
                          setLine(line.item.id, {
                            price: Math.max(0, Number(plain) || 0),
                          })
                        }
                      />
                      <div className="num b">{money(lineTotal(line))}</div>
                      <button
                        type="button"
                        className="btn-icon-danger"
                        aria-label={`حذف ${line.item.product.name}`}
                        onClick={() =>
                          setLines((current) =>
                            current.filter((entry) => entry.item.id !== line.item.id),
                          )
                        }
                      >
                        ✕
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="muted rows-empty">
                    برای شروع، بارکد را اسکن کنید یا نام قطعه را بالا بنویسید.
                  </p>
                )}
              </div>

              <div className="rows-foot">
                <span className="mut3">
                  ⚠ پس از صدور، موجودی به‌صورت خودکار و با ثبت در دفتر تراکنش‌ها کسر می‌شود.
                </span>
                <button type="button" className="btn-ghost-sm" onClick={resetForm}>
                  پاک کردن فرم
                </button>
              </div>
            </div>

            {/* Totals panel */}
            <div className="tot-panel">
              <div className="sec-h2">💳 مبالغ فاکتور</div>
              <div className="tot-b">
                <div className="ln">
                  <span>جمع اقلام ({persianNumber(lines.length)} قلم)</span>
                  <b>{money(subtotal)}</b>
                </div>
                <div className="invoice-discount-field field">
                  <span className="lab">تخفیف کل فاکتور (درصد)</span>
                  <div className="percent-input-wrap">
                    <FaNumberInput
                      className="money-in"
                      aria-label="درصد تخفیف کل فاکتور"
                      value={discount}
                      placeholder="۰"
                      onChange={(plain) =>
                        setDiscount(String(Math.min(100, Math.max(0, Number(plain) || 0))))
                      }
                    />
                    <b>٪</b>
                  </div>
                  <small>مبلغ تخفیف: {money(discountValue)}</small>
                </div>
                <div className="ln grand">
                  <span>مبلغ نهایی پس از تخفیف</span>
                  <b>{money(total)}</b>
                </div>

                <div className="paybox">
                  {methods.map((method) => {
                    const row = payments.find((entry) => entry.method === method.value);
                    const on = Boolean(row);
                    return (
                      <div className="pr" key={method.value}>
                        <button
                          type="button"
                          className={`chk${on ? ' on' : ''}`}
                          aria-pressed={on}
                          aria-label={method.label}
                          onClick={() =>
                            setPayments((current) =>
                              on
                                ? current.filter((entry) => entry.method !== method.value)
                                : [...current, { method: method.value, amount: '' }],
                            )
                          }
                        >
                          ✓
                        </button>
                        {method.label}
                        <FaNumberInput
                          className="money-in"
                          aria-label={`مبلغ ${method.label}`}
                          placeholder="۰"
                          disabled={!on}
                          value={row?.amount ?? ''}
                          onChange={(plain) =>
                            setPayments((current) =>
                              current.map((entry) =>
                                entry.method === method.value ? { ...entry, amount: plain } : entry,
                              ),
                            )
                          }
                        />
                      </div>
                    );
                  })}
                  {payments.some((entry) => entry.method === 'credit') && (
                    <div className="check-fields">
                      <b>جزئیات چک‌ها</b>
                      {checksDraft.map((check, index) => (
                        <div className="check-row" key={index}>
                          <strong>چک {index + 1}</strong>
                          <input
                            placeholder="شماره چک"
                            value={check.checkNumber}
                            onChange={(e) =>
                              setChecksDraft((all) =>
                                all.map((item, i) =>
                                  i === index ? { ...item, checkNumber: e.target.value } : item,
                                ),
                              )
                            }
                          />
                          <input
                            placeholder="بانک"
                            value={check.bank}
                            onChange={(e) =>
                              setChecksDraft((all) =>
                                all.map((item, i) =>
                                  i === index ? { ...item, bank: e.target.value } : item,
                                ),
                              )
                            }
                          />
                          <input
                            placeholder="شعبه"
                            value={check.branch}
                            onChange={(e) =>
                              setChecksDraft((all) =>
                                all.map((item, i) =>
                                  i === index ? { ...item, branch: e.target.value } : item,
                                ),
                              )
                            }
                          />
                          <JalaliDateInput
                            value={check.dueDate}
                            onChange={(value) =>
                              setChecksDraft((all) =>
                                all.map((item, i) =>
                                  i === index ? { ...item, dueDate: value } : item,
                                ),
                              )
                            }
                          />
                          <FaNumberInput
                            className="money-in"
                            placeholder="مبلغ چک"
                            value={check.amount}
                            onChange={(plain) =>
                              setChecksDraft((all) =>
                                all.map((item, i) =>
                                  i === index ? { ...item, amount: plain } : item,
                                ),
                              )
                            }
                          />
                        </div>
                      ))}
                      <button
                        type="button"
                        className="outline"
                        onClick={() =>
                          setChecksDraft((all) => [
                            ...all,
                            { checkNumber: '', bank: '', branch: '', dueDate: '', amount: '' },
                          ])
                        }
                      >
                        + افزودن چک
                      </button>
                    </div>
                  )}
                  <div className="hr" />
                  <div className="pr">
                    <span className="mut">پرداخت‌شده</span>
                    <b className="mono">{money(paymentTotal)}</b>
                  </div>
                  {total - paymentTotal > 0 && (
                    <button
                      type="button"
                      className="btn-ghost-sm settle"
                      onClick={() =>
                        setPayments((current) => {
                          const first = current[0] ?? { method: 'cash', amount: '' };
                          return [
                            {
                              ...first,
                              amount: String(Math.max(0, total - paymentTotal)),
                            },
                            ...current.slice(1),
                          ];
                        })
                      }
                    >
                      تسویه کامل با مانده
                    </button>
                  )}
                </div>

                {remainingDebt > 0 && (
                  <div className="debt-note">
                    <span>
                      باقی‌مانده <b className="mono">{money(remainingDebt)}</b> به‌صورت خودکار به
                      بدهی مشتری منتقل می‌شود.
                    </span>
                  </div>
                )}

                <button
                  className="btn-primary-lg"
                  disabled={!lines.length}
                  onClick={() => void create()}
                >
                  ✓ صدور فاکتور
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {linkFor && (
        <div className="modal-backdrop" onClick={() => setLinkFor(null)}>
          <div
            className="editor link-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-label={`لینک فاکتور ${linkFor.number}`}
          >
            <div className="editor-head">
              <div>
                <span className="eyebrow">لینک امن فاکتور</span>
                <h2>فاکتور {linkFor.number}</h2>
              </div>
              <button className="close" onClick={() => setLinkFor(null)}>
                بستن
              </button>
            </div>
            <div className="editor-body">
              {linkBusy && <p className="muted">در حال صدور لینک امن…</p>}
              {!linkBusy && !linkInfo && <p className="muted">لینکی صادر نشد.</p>}
              {linkInfo && (
                <>
                  <p className="modal-hint">
                    این لینک کوتاه و تصادفی است؛ شمارهٔ فاکتور در آن نمی‌آید و مشتری نمی‌تواند با
                    تغییر کد، به فاکتور دیگری برسد. صدور لینک جدید، لینک قبلی را باطل می‌کند.
                  </p>
                  <div className="link-box" dir="ltr">
                    <code>{shortLink(linkInfo.shortCode)}</code>
                  </div>
                  <div className="sheet-footer-actions">
                    <button onClick={copyInvoiceLink}>کپی لینک</button>
                    <a
                      className="outline"
                      href={shortLink(linkInfo.shortCode)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      بازکردن فاکتور آنلاین
                    </a>
                    <button
                      className="outline"
                      disabled={linkBusy}
                      onClick={() => void issueLink(linkFor)}
                    >
                      لینک جدید (ابطال قبلی)
                    </button>
                  </div>
                  {linkInfo.qrDataUrl && (
                    <div className="link-qr">
                      <img src={linkInfo.qrDataUrl} alt={`QR لینک فاکتور ${linkFor.number}`} />
                      <small className="muted">اسکن با دوربین موبایل مشتری</small>
                    </div>
                  )}
                  <p className="muted">
                    اعتبار لینک تا:{' '}
                    <b>
                      {linkInfo.expiresAt
                        ? new Date(linkInfo.expiresAt).toLocaleDateString('fa-IR')
                        : '—'}
                    </b>{' '}
                    (۳۰ روز)
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {paying && (
        <div className="modal-mask" role="dialog" aria-modal="true" aria-label="ثبت پرداخت">
          <div className="modal-mask-panel pay-modal">
            <header className="pay-modal-h">
              <b>ثبت پرداخت فاکتور {formatPersianNumber(paying.number)}</b>
              <button
                type="button"
                className="close"
                aria-label="بستن"
                onClick={() => {
                  setPaying(null);
                  setPayments([{ method: 'cash', amount: '' }]);
                }}
              >
                ✕
              </button>
            </header>
            <div className="pay-modal-body">
              <div className="ln">
                <span>مبلغ فاکتور</span>
                <b>{money(net(paying))}</b>
              </div>
              {Number(paying.returnedTotal ?? 0) > 0 && (
                <div className="ln">
                  <span>کسر مرجوعی‌ها</span>
                  <b>{money(paying.returnedTotal ?? 0)}</b>
                </div>
              )}
              <div className="ln">
                <span>دریافت‌شده تاکنون</span>
                <b>{money(paying.paidAmount)}</b>
              </div>
              <div className="ln grand">
                <span>مانده</span>
                <b>{money(Math.max(0, net(paying) - Number(paying.paidAmount)))}</b>
              </div>
              <div className="paybox">
                {methods.map((method) => {
                  const row = payments.find((entry) => entry.method === method.value);
                  const on = Boolean(row);
                  return (
                    <div className="pr" key={method.value}>
                      <button
                        type="button"
                        className={`chk${on ? ' on' : ''}`}
                        aria-pressed={on}
                        aria-label={method.label}
                        onClick={() =>
                          setPayments((current) =>
                            on
                              ? current.filter((entry) => entry.method !== method.value)
                              : [...current, { method: method.value, amount: '' }],
                          )
                        }
                      >
                        ✓
                      </button>
                      {method.label}
                      <FaNumberInput
                        className="money-in"
                        aria-label={`مبلغ ${method.label}`}
                        placeholder="۰"
                        disabled={!on}
                        value={row?.amount ?? ''}
                        onChange={(plain) =>
                          setPayments((current) =>
                            current.map((entry) =>
                              entry.method === method.value ? { ...entry, amount: plain } : entry,
                            ),
                          )
                        }
                      />
                    </div>
                  );
                })}
                {payments.some((entry) => entry.method === 'credit') && (
                  <div className="check-fields">
                    <b>جزئیات چک‌ها</b>
                    {checksDraft.map((check, index) => (
                      <div className="check-row" key={index}>
                        <strong>چک {index + 1}</strong>
                        <input
                          placeholder="شماره چک"
                          value={check.checkNumber}
                          onChange={(e) =>
                            setChecksDraft((all) =>
                              all.map((item, i) =>
                                i === index ? { ...item, checkNumber: e.target.value } : item,
                              ),
                            )
                          }
                        />
                        <input
                          placeholder="بانک"
                          value={check.bank}
                          onChange={(e) =>
                            setChecksDraft((all) =>
                              all.map((item, i) =>
                                i === index ? { ...item, bank: e.target.value } : item,
                              ),
                            )
                          }
                        />
                        <input
                          placeholder="شعبه"
                          value={check.branch}
                          onChange={(e) =>
                            setChecksDraft((all) =>
                              all.map((item, i) =>
                                i === index ? { ...item, branch: e.target.value } : item,
                              ),
                            )
                          }
                        />
                        <JalaliDateInput
                          value={check.dueDate}
                          onChange={(value) =>
                            setChecksDraft((all) =>
                              all.map((item, i) =>
                                i === index ? { ...item, dueDate: value } : item,
                              ),
                            )
                          }
                        />
                        <FaNumberInput
                          className="money-in"
                          placeholder="مبلغ چک"
                          value={check.amount}
                          onChange={(plain) =>
                            setChecksDraft((all) =>
                              all.map((item, i) =>
                                i === index ? { ...item, amount: plain } : item,
                              ),
                            )
                          }
                        />
                      </div>
                    ))}
                    <button
                      type="button"
                      className="outline"
                      onClick={() =>
                        setChecksDraft((all) => [
                          ...all,
                          { checkNumber: '', bank: '', branch: '', dueDate: '', amount: '' },
                        ])
                      }
                    >
                      + افزودن چک
                    </button>
                  </div>
                )}
              </div>
            </div>
            <footer className="pay-modal-f">
              <button
                className="button-primary"
                disabled={!payAmountValid()}
                onClick={() => void pay()}
              >
                ثبت پرداخت
              </button>
              <button
                className="outline"
                onClick={() => {
                  setPaying(null);
                  setPayments([{ method: 'cash', amount: '' }]);
                }}
              >
                انصراف
              </button>
            </footer>
          </div>
        </div>
      )}

      {tab === 'list' && (
        <>
          <div className="list-toolbar">
            <div className="search-field">
              <span className="search-icon">⌕</span>
              <input
                placeholder="جست‌وجوی لحظه‌ای شمارهٔ فاکتور، نام یا موبایل مشتری…"
                value={invoiceQuery}
                onChange={(event) => setInvoiceQuery(event.target.value)}
              />
              {invoiceQuery && (
                <button
                  type="button"
                  className="search-clear"
                  onClick={() => setInvoiceQuery('')}
                  aria-label="پاک کردن جست‌وجو"
                >
                  ✕
                </button>
              )}
            </div>
            <div className="pill-filters" role="tablist" aria-label="فیلتر وضعیت پرداخت">
              {(
                [
                  { id: 'all', label: 'همه' },
                  { id: 'unpaid', label: 'پرداخت‌نشده' },
                  { id: 'partial', label: 'پرداخت بخشی' },
                  { id: 'paid', label: 'تسویه‌شده' },
                ] as const
              ).map((entry) => (
                <button
                  key={entry.id}
                  role="tab"
                  aria-selected={statusFilter === entry.id}
                  className={statusFilter === entry.id ? 'pill active' : 'pill'}
                  onClick={() => setStatusFilter(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <div className="date-range-filters" aria-label="فیلتر بازهٔ تاریخ شمسی">
              <label>
                از تاریخ
                <JalaliDateInput
                  value={dateFrom}
                  onChange={setDateFrom}
                  aria-label="از تاریخ (شمسی)"
                />
              </label>
              <label>
                تا تاریخ
                <JalaliDateInput value={dateTo} onChange={setDateTo} aria-label="تا تاریخ (شمسی)" />
              </label>
              {(dateFrom || dateTo) && (
                <button
                  type="button"
                  className="outline"
                  onClick={() => {
                    setDateFrom('');
                    setDateTo('');
                  }}
                >
                  پاک کردن بازه
                </button>
              )}
            </div>
          </div>
          <div className="product-table">
            <div className="table-head invoice-head">
              <span>شماره</span>
              <span>تاریخ و ساعت</span>
              <span>مشتری</span>
              <span>اقلام</span>
              <span>مبلغ</span>
              <span>پرداخت</span>
              <span>بدهی</span>
              <span>عملیات</span>
            </div>
            {filteredRows.map((invoice) => {
              const debt = Math.max(0, net(invoice) - Number(invoice.paidAmount));
              const returned = returnedOf(invoice);
              const when = jalaliDateTime(invoice.issuedAt);
              return (
                <div className="table-row invoice-row" key={invoice.id}>
                  <code>{formatPersianNumber(invoice.number)}</code>
                  <span className="inv-when">
                    <b>{when.date}</b>
                    {when.time && <small dir="ltr">{when.time}</small>}
                  </span>
                  <span>{invoice.customerName ?? 'مشتری حضوری'}</span>
                  <span>
                    {persianNumber(invoice.itemCount ?? invoice.items?.length ?? 0)}
                    {returned > 0 && <small className="chip warn">برگشتی {money(returned)}</small>}
                  </span>
                  <strong>{money(net(invoice))}</strong>
                  <span className={invoice.paymentStatus === 'paid' ? 'status-chip' : 'low-stock'}>
                    {labels[invoice.paymentStatus] ?? invoice.paymentStatus}
                    <small> · {money(invoice.paidAmount)}</small>
                  </span>
                  {invoice.status === 'voided' || debt === 0 ? (
                    <span className="muted">—</span>
                  ) : (
                    <span className="low-stock">{money(debt)}</span>
                  )}
                  <span>
                    {invoice.status === 'voided' ? (
                      labels.voided
                    ) : (
                      <span className="row-actions">
                        <button className="row-action" onClick={() => openViewing(invoice)}>
                          نمایش / برگشت
                        </button>
                        <button
                          className="row-action"
                          onClick={() => void downloadInvoicePdf(invoice)}
                          title="دانلود پی‌دی‌اف"
                        >
                          PDF
                        </button>
                        <button
                          className="row-action"
                          onClick={() => {
                            setLinkFor(invoice);
                            void issueLink(invoice);
                          }}
                          title="لینک کوتاه امن فاکتور برای مشتری"
                        >
                          لینک
                        </button>
                        {canPay && net(invoice) > Number(invoice.paidAmount) && (
                          <button
                            className="row-action"
                            onClick={() => {
                              setPaying(invoice);
                              setPayments([
                                {
                                  method: 'cash',
                                  amount: String(
                                    Math.max(0, net(invoice) - Number(invoice.paidAmount)),
                                  ),
                                },
                              ]);
                            }}
                          >
                            پرداخت
                          </button>
                        )}
                        {canResend && (
                          <button className="row-action" onClick={() => void resend(invoice)}>
                            پیامک مجدد
                          </button>
                        )}
                        {canVoid && (
                          <button
                            className="row-action danger-text"
                            onClick={async () => {
                              if (!window.confirm('فاکتور باطل شود؟')) return;
                              try {
                                await api(`/invoices/${invoice.id}/void`, { method: 'POST' });
                                setMessage('فاکتور باطل و موجودی برگشت داده شد.');
                                await load();
                              } catch (error) {
                                setMessage((error as Error).message);
                              }
                            }}
                          >
                            ابطال
                          </button>
                        )}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
      {viewing && (
        <div className="modal-backdrop" onClick={() => setViewing(null)}>
          <div
            className="editor invoice-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-label={`جزئیات فاکتور ${formatPersianNumber(viewing.number)}`}
          >
            <div className="editor-head">
              <div>
                <span className="eyebrow">جزئیات و برگشت اقلام</span>
                <h2>فاکتور {formatPersianNumber(viewing.number)}</h2>
              </div>
              <button className="close" onClick={() => setViewing(null)}>
                بستن
              </button>
            </div>
            <div className="editor-body">
              <div className="invoice-detail-grid">
                <span>
                  مشتری: <b>{viewing.customerName ?? 'مشتری حضوری'}</b>
                </span>
                <span>
                  شماره تماس مشتری:{' '}
                  <b dir="ltr">{formatPersianNumber(viewing.customerMobile ?? '—')}</b>
                </span>
                <span>
                  تاریخ صدور: <b>{new Date(viewing.issuedAt).toLocaleDateString('fa-IR')}</b>
                </span>
                <span>
                  مبلغ اولیه: <b>{money(viewing.total)}</b>
                </span>
                {returnedOf(viewing) > 0 && (
                  <span>
                    برگشتی: <b>{money(returnedOf(viewing))}</b>
                  </span>
                )}
                <span>
                  مبلغ نهایی: <b>{money(net(viewing))}</b>
                </span>
                <span>
                  پرداخت‌شده: <b>{money(viewing.paidAmount)}</b>
                </span>
                <span>
                  {net(viewing) - Number(viewing.paidAmount) >= 0 ? 'بدهی' : 'بازپرداخت به مشتری'}:{' '}
                  <b>{money(Math.abs(net(viewing) - Number(viewing.paidAmount)))}</b>
                </span>
              </div>

              <div className="invoice-address-edit">
                <label>
                  آدرس فروشگاه
                  <textarea
                    rows={2}
                    value={addressDraft.store}
                    onChange={(event) =>
                      setAddressDraft({ ...addressDraft, store: event.target.value })
                    }
                  />
                </label>
                <label>
                  شماره تماس فروشگاه
                  <input
                    dir="ltr"
                    value={addressDraft.phone}
                    onChange={(event) =>
                      setAddressDraft({ ...addressDraft, phone: event.target.value })
                    }
                  />
                </label>
                <label>
                  آدرس مشتری
                  <textarea
                    rows={2}
                    value={addressDraft.customer}
                    onChange={(event) =>
                      setAddressDraft({ ...addressDraft, customer: event.target.value })
                    }
                  />
                </label>
                <button
                  className="row-action"
                  disabled={addressBusy}
                  onClick={() => void saveAddresses()}
                >
                  {addressBusy ? 'در حال ذخیره…' : 'ذخیرهٔ آدرس‌ها'}
                </button>
              </div>

              <div className="invoice-detail-items">
                {(viewing.items ?? []).map((item) => {
                  const returnedQty = item.returnedQuantity ?? 0;
                  const remaining = lineRemaining(item.quantity, returnedQty);
                  return (
                    <div className="inv-detail-line" key={item.id}>
                      <span>
                        <b>{item.productName}</b>
                        {item.inventoryItem?.brand?.name ? (
                          <small> · {item.inventoryItem.brand.name}</small>
                        ) : null}
                      </span>
                      <span>
                        {persianNumber(item.quantity)} × {money(item.unitPrice)} ={' '}
                        <b>{money(item.lineTotal)}</b>
                      </span>
                      {returnedQty > 0 && (
                        <span className="chip warn">
                          {persianNumber(returnedQty)} برگشتی · {persianNumber(remaining)} باقی
                        </span>
                      )}
                      {viewing.status !== 'voided' && remaining > 0 && (
                        <button className="row-action" onClick={() => openReturn(viewing, item)}>
                          برگشت
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {viewing.returns?.length ? (
                <div className="returns-history">
                  <h3>تاریخچهٔ برگشتی‌ها</h3>
                  {viewing.returns.map((record) => {
                    const line = (viewing.items ?? []).find(
                      (item) => item.id === record.invoiceItemId,
                    );
                    return (
                      <div key={record.id}>
                        <b>{line?.productName ?? '—'}</b>
                        <span>{persianNumber(record.quantity)} عدد</span>
                        <span>{money(record.refundAmount)}</span>
                        <small>
                          {record.restock ? 'به انبار برگشت' : 'خراب — بدون بازگشت به انبار'}
                        </small>
                        <small>{record.reason}</small>
                        <small>{new Date(record.createdAt).toLocaleDateString('fa-IR')}</small>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {returnLine && (
        <div className="modal-backdrop" onClick={() => setReturnLine(null)}>
          <div
            className="editor return-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-label={`ثبت برگشت ${returnLine.item.productName}`}
          >
            <div className="editor-head">
              <div>
                <span className="eyebrow">برگشت جزیی قلم</span>
                <h2>{returnLine.item.productName}</h2>
              </div>
              <button className="close" onClick={() => setReturnLine(null)}>
                بستن
              </button>
            </div>
            <div className="editor-body">
              <p className="modal-hint">
                از {persianNumber(returnLine.item.quantity)} عددِ این قلم در فاکتور،{' '}
                {persianNumber(returnLine.item.returnedQuantity ?? 0)} عدد برگشت خورده است. حداکثر{' '}
                {persianNumber(returnLine.item.quantity - (returnLine.item.returnedQuantity ?? 0))}{' '}
                عدد می‌توانید برگشت بزنید؛ باقی در فاکتور می‌ماند.
              </p>
              <div className="return-form">
                <label>
                  تعداد برگشتی
                  <FaNumberInput
                    value={returnQty}
                    placeholder="۱"
                    onChange={(plain) => setReturnQty(plain)}
                  />
                </label>
                <label>
                  دلیل مرجوعی (الزامی)
                  <input
                    value={returnReason}
                    onChange={(event) => setReturnReason(event.target.value)}
                    placeholder="مثلاً: ناسازگاری با خودرو / خرابی / توافق با مشتری"
                  />
                </label>
                <label className="restock-toggle">
                  <input
                    type="checkbox"
                    checked={returnRestock}
                    onChange={(event) => setReturnRestock(event.target.checked)}
                  />
                  <span>
                    قطعه سالم است و به دارایی انبار برگردد
                    <small>
                      اگر خاموش بماند (قطعهٔ خراب)، موجودی انبار زیاد نمی‌شود و فقط مبلغ فاکتور کم
                      می‌شود.
                    </small>
                  </span>
                </label>
                <p className="muted">
                  مبلغ کسرشده از فاکتور:{' '}
                  <b>{money(Number(returnLine.item.unitPrice) * (Number(returnQty) || 0))}</b>
                </p>
              </div>
            </div>
            <div className="editor-footer">
              <button
                className="button-primary"
                disabled={returnBusy}
                onClick={() => void submitReturn()}
              >
                {returnBusy ? 'در حال ثبت…' : 'ثبت برگشت'}
              </button>
              <button className="outline" onClick={() => setReturnLine(null)}>
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// Lazy camera scanner: html5-qrcode only loads when the operator asks for it.
function BarcodeHost({ onCode }: { onCode: (code: string) => void }) {
  const [Scanner, setScanner] = useState<
    null | typeof import('../components/BarcodeScanner').BarcodeScanner
  >(null);
  useEffect(() => {
    import('../components/BarcodeScanner').then((module) =>
      setScanner(() => module.BarcodeScanner),
    );
  }, []);
  if (!Scanner) return <p className="muted">در حال آماده‌سازی دوربین…</p>;
  return <Scanner onCode={onCode} />;
}
