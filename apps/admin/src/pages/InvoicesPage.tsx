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
import { api, downloadFile } from '../lib/api';
import { publicSiteUrl } from '../lib/public-site';
import { paramsFromHash } from '../lib/admin-route';

type Invoice = {
  id: string;
  number: string;
  customerName?: string | null;
  customerMobile?: string | null;
  storeAddress?: string | null;
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
  items: InvoiceItemRow[];
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
type DraftLine = { item: StockOption; quantity: number; lineDiscount: number };
type CreatedInvoice = {
  id: string;
  number: string;
  publicToken: string;
  publicShortCode: string;
  total: number;
  paid: number;
  qrDataUrl?: string;
};

const methods = [
  { value: 'cash', label: 'نقدی' },
  { value: 'card', label: 'کارت' },
  { value: 'transfer', label: 'واریز' },
  { value: 'credit', label: 'اعتباری' },
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
  const [quantity, setQuantity] = useState('1');
  const [search, setSearch] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [mobile, setMobile] = useState('');
  const [discount, setDiscount] = useState('');
  const [payments, setPayments] = useState<PaymentRow[]>([{ method: 'cash', amount: '' }]);
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
  const [invoiceQuery, setInvoiceQuery] = useState('');
  const [created, setCreated] = useState<CreatedInvoice | null>(null);
  // Two tabs: issuing lives apart from the issued-invoices register so sellers
  // can work the POS flow and the archive independently.
  const [tab, setTab] = useState<'issue' | 'list'>(canCreate ? 'issue' : 'list');
  // Addresses on the invoice (store snapshot + customer), editable later.
  const [storeAddress, setStoreAddress] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [addressDraft, setAddressDraft] = useState({ store: '', customer: '' });
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
    api<{ data: Invoice[] }>('/invoices')
      .then((result) => {
        setRows(result.data);
        return result.data;
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
        void api<{ data: Invoice[] }>('/invoices')
          .then((result) => {
            setRows(result.data);
            const found = result.data.find((row) => row.id === invoiceId);
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
      void api<{ data: StockOption[]; storeAddress?: string }>('/invoices/options')
        .then((result) => {
          setOptions(result.data);
          // Store address snapshot from settings — sellers cannot read
          // /settings directly, so it travels with the invoice options.
          if (result.storeAddress) setStoreAddress(result.storeAddress);
        })
        .catch((error: Error) => setMessage(error.message));
  }, [canCreate]);

  // Customer lookup is debounced: typing a mobile must not fire a request per key.
  useEffect(() => {
    const query = customerQuery.trim();
    if (!canCreate || !query) {
      setCustomers([]);
      return;
    }
    const handle = window.setTimeout(() => {
      void api<{ data: CustomerOption[] }>(`/customers?search=${encodeURIComponent(query)}`)
        .then((result) => setCustomers(result.data))
        .catch(() => setCustomers([]));
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

  const lineTotal = (line: DraftLine) =>
    invoiceTotals(
      [
        {
          salePrice: Number(line.item.salePrice),
          quantity: line.quantity,
          lineDiscount: line.lineDiscount,
        },
      ],
      0,
    ).total;
  const {
    subtotal,
    discount: discountValue,
    total,
  } = invoiceTotals(
    lines.map((line) => ({
      salePrice: Number(line.item.salePrice),
      quantity: line.quantity,
      lineDiscount: line.lineDiscount,
    })),
    Number(discount) || 0,
  );
  const paymentTotal = sumPayments(payments);
  const remainingDebt = debtLeft(total, payments);

  const addLine = (item: StockOption, qty = Number(quantity) || 1) => {
    if (!Number.isInteger(qty) || qty <= 0) return setMessage('تعداد باید عدد صحیح مثبت باشد');
    const existing = lines.find((line) => line.item.id === item.id);
    const nextQty = (existing?.quantity ?? 0) + qty;
    if (nextQty > item.quantity)
      return setMessage(`موجودی ${item.product.name} فقط ${item.quantity} عدد است`);
    setLines((current) =>
      existing
        ? current.map((line) => (line.item.id === item.id ? { ...line, quantity: nextQty } : line))
        : [...current, { item, quantity: qty, lineDiscount: 0 }],
    );
    setQuantity('1');
    setSearch('');
    setMessage('');
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
          storeAddress: storeAddress.trim() || undefined,
          customerAddress: customerAddress.trim() || undefined,
          discount: discountValue,
          items: lines.map((line) => ({
            inventoryItemId: line.item.id,
            quantity: line.quantity,
            // Per-line discount is folded into the unit price, the only money field the API accepts.
            unitPrice: discountedUnitPrice(
              Number(line.item.salePrice),
              line.quantity,
              line.lineDiscount,
            ),
          })),
        }),
      });
      for (const row of payments) {
        const amount = Math.round(Number(row.amount) || 0);
        if (amount <= 0) continue;
        await api(`/invoices/${response.data.id}/pay`, {
          method: 'POST',
          body: JSON.stringify({ amount: String(amount), method: row.method }),
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
        qrDataUrl: qr.data.dataUrl,
      });
      setMessage('فاکتور صادر شد و موجودی به‌صورت اتمیک در Ledger ثبت شد.');
      setLines([]);
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
          body: JSON.stringify({ amount: String(amount), method: row.method }),
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
  const openViewing = (invoice: Invoice) => {
    setViewing(invoice);
    setAddressDraft({ store: invoice.storeAddress ?? '', customer: invoice.customerAddress ?? '' });
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
          customerAddress: addressDraft.customer,
        }),
      });
      setMessage(`آدرس‌های فاکتور ${viewing.number} ذخیره شد.`);
      const updated = await load();
      setViewing(updated.find((row) => row.id === viewing.id) ?? null);
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

  const submitReturn = async () => {
    if (!returnLine) return;
    const remaining = lineRemaining(returnLine.item.quantity, returnLine.item.returnedQuantity);
    const qty = Number(returnQty);
    const reason = returnReason.trim();
    if (!Number.isInteger(qty) || qty <= 0 || qty > remaining)
      return setMessage(`تعداد برگشت باید بین ۱ تا ${remaining} باشد`);
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
      setMessage(
        `${qty} عدد «${returnLine.item.productName}» برگشت خورده شد؛ مبلغ فاکتور کم شد${
          returnRestock ? ' و قطعه به دارایی انبار برگشت' : ' (خراب — به انبار برنگشت)'
        }.`,
      );
      const updated = await load();
      if (viewing) setViewing(updated.find((row) => row.id === returnLine.invoice.id) ?? null);
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
      setMessage(`پیامک فاکتور ${invoice.number} در صف ارسال قرار گرفت. لینک جدید: ${link}`);
      void navigator.clipboard?.writeText(link);
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  // The archive is searchable the moment you type — number, name or mobile.
  const filteredRows = useMemo(() => {
    const query = invoiceQuery.trim().toLocaleLowerCase();
    return rows
      .filter((invoice) => statusFilter === 'all' || invoice.paymentStatus === statusFilter)
      .filter(
        (invoice) =>
          !query ||
          `${invoice.number} ${invoice.customerName ?? ''} ${invoice.customerMobile ?? ''}`
            .toLocaleLowerCase()
            .includes(query),
      );
  }, [rows, statusFilter, invoiceQuery]);

  const net = (invoice: Invoice) => netInvoiceAmount(invoice.total, invoice.netTotal);
  const returnedOf = (invoice: Invoice) => Number(invoice.returnedTotal ?? 0);

  return (
    <section className="invoices-page">
      <div className="page-title">
        <div>
          <h1>فروش و فاکتورها</h1>
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
        <div
          className="invoice-success"
          role="dialog"
          aria-modal="true"
          aria-label="فاکتور صادر شد"
        >
          <div className="invoice-success-card">
            <span className="success-mark">✓</span>
            <h2>فاکتور {created.number} صادر شد</h2>
            <p>
              لینک کوتاه و QR فاکتور برای مشتری آماده است و ۳۰ روز اعتبار دارد.{' '}
              {created.paid > 0 ? `دریافتی ${money(created.paid)} ثبت شد.` : ''}{' '}
              {created.total - created.paid > 0
                ? `مانده بدهی ${money(created.total - created.paid)}.`
                : ''}
            </p>
            {created.qrDataUrl ? (
              <img className="invoice-qr" src={created.qrDataUrl} alt="QR فاکتور" />
            ) : (
              <span className="muted">QR در دسترس نیست</span>
            )}
            <input
              readOnly
              value={shortLink(created.publicShortCode)}
              onFocus={(event) => event.currentTarget.select()}
            />
            <div>
              <button
                onClick={() =>
                  void navigator.clipboard?.writeText(shortLink(created.publicShortCode))
                }
              >
                کپی لینک
              </button>
              <a
                className="button-primary"
                target="_blank"
                rel="noreferrer"
                href={shortLink(created.publicShortCode)}
              >
                مشاهده فاکتور
              </a>
              <button
                className="outline"
                onClick={() => {
                  setCreated(null);
                  searchRef.current?.focus();
                }}
              >
                فاکتور بعدی
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'issue' && canCreate && (
        <div className="cards invoice-form">
          <div>
            <h2>صدور فاکتور جدید</h2>
            <div className="invoice-product-picker">
              <input
                ref={searchRef}
                aria-label="جست‌وجو یا اسکن قلم"
                placeholder="نام، کد یا بارکد را تایپ کنید (اسکنر + Enter)"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={onSearchKeyDown}
              />
              <input
                aria-label="تعداد قلم"
                type="number"
                min="1"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
              <button
                type="button"
                className="row-action"
                onClick={() => setScanning((current) => !current)}
              >
                📷 اسکن دوربین
              </button>
              {scanning && <BarcodeHost onCode={(code) => void onScanned(code)} />}
              {search && !scanning && (
                <div className="invoice-candidates">
                  {candidates.length ? (
                    candidates.map((item) => (
                      <button type="button" key={item.id} onClick={() => addLine(item)}>
                        <b>{item.product.name}</b>
                        <span>
                          {item.brand.name} · <span dir="ltr">{item.product.code}</span> · بارکد{' '}
                          <span dir="ltr">{item.barcode}</span> · قفسه {item.location?.code ?? '—'}
                        </span>
                        <strong>{persianNumber(item.quantity)} عدد</strong>
                      </button>
                    ))
                  ) : (
                    <small>قلم موجودی پیدا نشد.</small>
                  )}
                </div>
              )}
            </div>

            <div className="invoice-lines">
              {lines.length ? (
                lines.map((line) => (
                  <div className="invoice-line" key={line.item.id}>
                    <span>
                      <b>{line.item.product.name}</b>
                      <small>
                        {line.item.brand.name} · {money(line.item.salePrice)} · قفسه{' '}
                        {line.item.location?.code ?? '—'}
                      </small>
                    </span>
                    <input
                      aria-label={`تعداد ${line.item.product.name}`}
                      type="number"
                      min="1"
                      max={line.item.quantity}
                      value={line.quantity}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((entry) =>
                            entry.item.id === line.item.id
                              ? {
                                  ...entry,
                                  quantity: Math.min(
                                    line.item.quantity,
                                    Math.max(1, Number(event.target.value) || 1),
                                  ),
                                }
                              : entry,
                          ),
                        )
                      }
                    />
                    <input
                      aria-label={`تخفیف ${line.item.product.name}`}
                      type="number"
                      min="0"
                      placeholder="تخفیف قلم"
                      value={line.lineDiscount || ''}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((entry) =>
                            entry.item.id === line.item.id
                              ? {
                                  ...entry,
                                  lineDiscount: Math.max(0, Number(event.target.value) || 0),
                                }
                              : entry,
                          ),
                        )
                      }
                    />
                    <strong>{money(lineTotal(line))}</strong>
                    <button
                      type="button"
                      aria-label={`حذف ${line.item.product.name}`}
                      onClick={() =>
                        setLines((current) =>
                          current.filter((entry) => entry.item.id !== line.item.id),
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                ))
              ) : (
                <p className="muted">برای شروع، بارکد را اسکن کنید یا نام قلم را جست‌وجو کنید.</p>
              )}
            </div>

            <div className="form-grid">
              <div className="invoice-product-picker">
                <input
                  aria-label="جست‌وجوی مشتری"
                  placeholder="جست‌وجوی مشتری با نام یا موبایل..."
                  value={customerQuery}
                  onChange={(event) => setCustomerQuery(event.target.value)}
                />
                {customerQuery && (
                  <div className="invoice-candidates">
                    {customers.length ? (
                      customers.map((customer) => (
                        <button
                          type="button"
                          key={customer.id}
                          onClick={() => {
                            setCustomerName(customer.name);
                            setMobile(customer.mobile);
                            setCustomerAddress(customer.address ?? '');
                            setCustomerQuery('');
                            setCustomers([]);
                          }}
                        >
                          <b>{customer.name}</b>
                          <span>
                            <span dir="ltr">{customer.mobile}</span> · بدهی{' '}
                            {money(customer.debt ?? 0)}
                          </span>
                        </button>
                      ))
                    ) : (
                      <small>مشتری پیدا نشد؛ نام و موبایل را دستی وارد کنید.</small>
                    )}
                  </div>
                )}
              </div>
              <input
                aria-label="نام مشتری"
                placeholder="نام مشتری (اختیاری)"
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
              />
              <input
                aria-label="موبایل مشتری"
                dir="ltr"
                placeholder="09xxxxxxxxx"
                value={mobile}
                onChange={(event) => setMobile(event.target.value)}
              />
              <input
                aria-label="تخفیف کل"
                type="number"
                min="0"
                placeholder="تخفیف کل (ریال)"
                value={discount}
                onChange={(event) => setDiscount(event.target.value)}
              />
            </div>

            <div className="form-grid invoice-addresses">
              <label>
                آدرس فروشگاه (روی فاکتور چاپ و نمایش داده می‌شود)
                <textarea
                  rows={2}
                  value={storeAddress}
                  onChange={(event) => setStoreAddress(event.target.value)}
                  placeholder="آدرس فروشگاه — از تنظیمات پیش‌فرض آمده و قابل ویرایش است"
                />
              </label>
              <label>
                آدرس مشتری (اختیاری — برای ارسال و پروندهٔ مشتری)
                <textarea
                  rows={2}
                  value={customerAddress}
                  onChange={(event) => setCustomerAddress(event.target.value)}
                  placeholder="آدرس مشتری؛ با انتخاب مشتری از لیست، از پروندهٔ او پر می‌شود"
                />
              </label>
            </div>

            <h3 className="muted">دریافت‌ها</h3>
            {payments.map((row, index) => (
              <div className="payment-row" key={index}>
                <select
                  aria-label="روش پرداخت"
                  value={row.method}
                  onChange={(event) =>
                    setPayments((current) =>
                      current.map((entry, i) =>
                        i === index ? { ...entry, method: event.target.value } : entry,
                      ),
                    )
                  }
                >
                  {methods.map((method) => (
                    <option key={method.value} value={method.value}>
                      {method.label}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="مبلغ پرداخت"
                  type="number"
                  min="0"
                  placeholder="مبلغ (ریال)"
                  value={row.amount}
                  onChange={(event) =>
                    setPayments((current) =>
                      current.map((entry, i) =>
                        i === index ? { ...entry, amount: event.target.value } : entry,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="row-action"
                  onClick={() =>
                    setPayments((current) =>
                      current.map((entry, i) =>
                        i === index
                          ? {
                              ...entry,
                              amount: String(
                                Math.max(0, total - paymentTotal + (Number(entry.amount) || 0)),
                              ),
                            }
                          : entry,
                      ),
                    )
                  }
                >
                  مانده
                </button>
                {payments.length > 1 && (
                  <button
                    type="button"
                    aria-label="حذف ردیف پرداخت"
                    onClick={() => setPayments((current) => current.filter((_, i) => i !== index))}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="row-action"
              onClick={() => setPayments((current) => [...current, { method: 'card', amount: '' }])}
            >
              + افزودن روش پرداخت
            </button>

            <div className="invoice-totals">
              <span>
                جمع اقلام: <b>{money(subtotal)}</b>
              </span>
              <span>
                تخفیف: <b>{money(discountValue)}</b>
              </span>
              <span>
                دریافتی: <b>{money(paymentTotal)}</b>
              </span>
              <strong>قابل پرداخت: {money(total)}</strong>
              {remainingDebt > 0 && (
                <span className="low-stock">بدهی مشتری: {money(remainingDebt)}</span>
              )}
            </div>
            <button
              className="button-primary"
              disabled={!lines.length}
              onClick={() => void create()}
            >
              صدور فاکتور
            </button>
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
        <div className="notice">
          <strong>ثبت پرداخت {paying.number}</strong>
          <span className="muted">
            مبلغ فاکتور {money(paying.total)} · دریافت‌شده {money(paying.paidAmount)}
          </span>
          {payments.map((row, index) => (
            <div className="payment-row" key={index}>
              <select
                aria-label="روش پرداخت"
                value={row.method}
                onChange={(event) =>
                  setPayments((current) =>
                    current.map((entry, i) =>
                      i === index ? { ...entry, method: event.target.value } : entry,
                    ),
                  )
                }
              >
                {methods.map((method) => (
                  <option key={method.value} value={method.value}>
                    {method.label}
                  </option>
                ))}
              </select>
              <input
                aria-label="مبلغ پرداخت"
                type="number"
                min="0"
                value={row.amount}
                onChange={(event) =>
                  setPayments((current) =>
                    current.map((entry, i) =>
                      i === index ? { ...entry, amount: event.target.value } : entry,
                    ),
                  )
                }
              />
            </div>
          ))}
          <button disabled={!payAmountValid()} onClick={() => void pay()}>
            ثبت
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
          </div>
          <div className="product-table">
            <div className="table-head invoice-head">
              <span>شماره</span>
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
              return (
                <div className="table-row invoice-row" key={invoice.id}>
                  <code>{invoice.number}</code>
                  <span>{invoice.customerName ?? 'مشتری حضوری'}</span>
                  <span>
                    {persianNumber(invoice.items.length)}
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
                        {canPay && Number(invoice.total) > Number(invoice.paidAmount) && (
                          <button
                            className="row-action"
                            onClick={() => {
                              setPaying(invoice);
                              setPayments([
                                {
                                  method: 'cash',
                                  amount: String(
                                    Math.max(0, Number(invoice.total) - Number(invoice.paidAmount)),
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
            aria-label={`جزئیات فاکتور ${viewing.number}`}
          >
            <div className="editor-head">
              <div>
                <span className="eyebrow">جزئیات و برگشت اقلام</span>
                <h2>فاکتور {viewing.number}</h2>
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
                {viewing.items.map((item) => {
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
                    const line = viewing.items.find((item) => item.id === record.invoiceItemId);
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
                  <input
                    type="number"
                    min="1"
                    max={returnLine.item.quantity - (returnLine.item.returnedQuantity ?? 0)}
                    value={returnQty}
                    onChange={(event) => setReturnQty(event.target.value)}
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
