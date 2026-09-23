import { useEffect, useMemo, useState } from 'react';
import { formatJalaliDate, formatPersianNumber, formatRial } from '@salimvand/shared';
import { FaNumberInput } from '../components/FaNumberInput';
import { api, fetchAllPages } from '../lib/api';
import { JalaliDateInput } from '../components/JalaliDateInput';

type Supplier = { id: string; name: string };
type Item = {
  id: string;
  barcode: string;
  product: { name: string; code: string };
  /** brandId is nullable in the DB — legacy items can exist without a brand. */
  brand: { name: string } | null;
  quantity: number;
};
type Line = { inventoryItemId: string; productName: string; quantity: number; unitPrice: string };
type Payment = {
  id: string;
  amount: string | number;
  method: string;
  notes?: string | null;
  paidAt: string;
  check?: {
    id: string;
    checkNumber?: string | null;
    bank?: string | null;
    amount: string | number;
    dueDate: string;
    status: string;
  } | null;
};
type PurchaseItem = {
  id: string;
  productName: string;
  quantity: number;
  unitPrice: string | number;
  lineTotal: string | number;
};
type Purchase = {
  id: string;
  number: string;
  supplierName: string;
  total: string | number;
  paidAmount: string | number;
  debt?: string | number;
  status: string;
  issuedAt: string;
  items?: PurchaseItem[];
  payments?: Payment[];
};
const paymentLabels: Record<string, string> = {
  cash: 'نقدی',
  card: 'کارت',
  transfer: 'واریز',
  credit: 'اعتباری',
};

export function PurchasesPage({ canCreate = true }: { canCreate?: boolean }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [supplierFilter, setSupplierFilter] = useState('');
  const [itemQuery, setItemQuery] = useState('');
  const [detail, setDetail] = useState<Purchase | null>(null);
  const [payFor, setPayFor] = useState<Purchase | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('transfer');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [supplierCheck, setSupplierCheck] = useState({
    checkNumber: '',
    bank: '',
    branch: '',
    dueDate: '',
    amount: '',
  });
  const [supplierId, setSupplierId] = useState('');
  const [itemId, setItemId] = useState('');
  const [itemOpen, setItemOpen] = useState(false);
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [paidAmount, setPaidAmount] = useState('0');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const loadPurchases = async (filter = supplierFilter) => {
    try {
      setPurchases(
        (
          await api<{ data: Purchase[] }>(
            `/purchases${filter ? `?supplierId=${encodeURIComponent(filter)}` : ''}`,
          )
        ).data,
      );
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  useEffect(() => {
    void Promise.all([
      api<{ data: Supplier[] }>('/suppliers'),
      // Cursor-paginated endpoint: drain the pages for the item picker.
      fetchAllPages<Item>('/inventory/items', { limit: 500 }),
    ])
      .then(([supplierResult, items]) => {
        setSuppliers(supplierResult.data);
        setItems(items);
      })
      .catch((error: Error) => setMessage(error.message));
    void loadPurchases();
  }, []);
  const visibleItems = useMemo(() => {
    const query = itemQuery.trim().toLocaleLowerCase('fa');
    return query
      ? items.filter((item) =>
          `${item.product.name} ${item.product.code} ${item.brand?.name ?? ''} ${item.barcode}`
            .toLocaleLowerCase('fa')
            .includes(query),
        )
      : items;
  }, [itemQuery, items]);
  const total = lines.reduce(
    (sum, line) => sum + BigInt(line.quantity) * BigInt(line.unitPrice),
    0n,
  );

  const addLine = () => {
    const item = items.find((row) => row.id === itemId);
    const count = Number(quantity);
    const errors: Record<string, string> = {};
    if (!item) errors.item = 'قلم خرید را انتخاب کنید';
    if (!Number.isInteger(count) || count <= 0) errors.quantity = 'تعداد باید صحیح و مثبت باشد';
    if (!/^\d+$/.test(unitPrice) || BigInt(unitPrice || 0) <= 0n)
      errors.unitPrice = 'قیمت خرید مثبت الزامی است';
    if (Object.keys(errors).length || !item) return setFieldErrors(errors);
    setFieldErrors({});
    const existing = lines.find((line) => line.inventoryItemId === item.id);
    if (existing && existing.unitPrice !== unitPrice)
      return setMessage('برای یک قلم، دو قیمت متفاوت وارد نکنید.');
    setLines(
      existing
        ? lines.map((line) =>
            line.inventoryItemId === item.id ? { ...line, quantity: line.quantity + count } : line,
          )
        : [
            ...lines,
            {
              inventoryItemId: item.id,
              productName: `${item.product.name} · ${item.brand?.name ?? 'بدون برند'}`,
              quantity: count,
              unitPrice,
            },
          ],
    );
    setItemId('');
    setQuantity('1');
    setUnitPrice('');
    setItemQuery('');
  };
  const submit = async () => {
    const errors: Record<string, string> = {};
    if (!supplierId) errors.supplier = 'تأمین‌کننده را انتخاب کنید';
    if (!lines.length) errors.lines = 'حداقل یک قلم خرید اضافه کنید';
    if (!/^\d+$/.test(paidAmount) || BigInt(paidAmount || 0) > total)
      errors.paidAmount = 'پرداخت اولیه باید بین صفر و جمع فاکتور باشد';
    if (Object.keys(errors).length) return setFieldErrors(errors);
    setLoading(true);
    try {
      const created = await api<{ data: Purchase }>('/purchases', {
        method: 'POST',
        body: JSON.stringify({ supplierId, paidAmount, lines }),
      });
      setMessage(
        `فاکتور ${formatPersianNumber(created.data.number)} ثبت و موجودی به‌صورت اتمیک افزایش یافت.`,
      );
      setLines([]);
      setPaidAmount('0');
      setSupplierId('');
      await loadPurchases();
      await openDetail(created.data.id);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const openDetail = async (id: string) => {
    setLoading(true);
    try {
      setDetail((await api<{ data: Purchase }>(`/purchases/${id}`)).data);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const pay = async () => {
    if (
      !payFor ||
      !/^\d+$/.test(paymentAmount) ||
      BigInt(paymentAmount) <= 0n ||
      BigInt(paymentAmount) > BigInt(payFor.total) - BigInt(payFor.paidAmount)
    )
      return setMessage('مبلغ پرداخت باید مثبت و حداکثر برابر مانده فاکتور باشد.');
    setLoading(true);
    try {
      await api(`/purchases/${payFor.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amount: paymentAmount,
          method: paymentMethod,
          notes: paymentNotes,
          ...(paymentMethod === 'credit'
            ? { check: { ...supplierCheck, amount: supplierCheck.amount || paymentAmount } }
            : {}),
        }),
      });
      setMessage('پرداخت تأمین‌کننده ثبت شد.');
      const id = payFor.id;
      setPayFor(null);
      setPaymentAmount('');
      setPaymentNotes('');
      await loadPurchases();
      await openDetail(id);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="purchases-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">خرید و تأمین</span>
          <h1>فاکتورهای خرید</h1>
          <p className="muted">ثبت خرید، افزایش موجودی و پیگیری پرداخت تأمین‌کننده</p>
        </div>
        <span className="count">{formatPersianNumber(purchases.length)} فاکتور</span>
      </div>
      {message && <div className="notice">{message}</div>}
      {canCreate && (
        <div className="purchase-builder">
          <header>
            <div>
              <h2>ثبت خرید جدید</h2>
              <p>هر قلم مستقیماً به موجودی برند مربوط متصل می‌شود.</p>
            </div>
            <strong>{formatRial(Number(total))}</strong>
          </header>
          <div className="purchase-fields">
            <label>
              تأمین‌کننده
              <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
                <option value="">انتخاب تأمین‌کننده</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
              {fieldErrors.supplier && (
                <small className="field-error">{fieldErrors.supplier}</small>
              )}
            </label>
            <label className="purchase-item-picker">
              قلم انبار
              <div className="purchase-item-combobox">
                <input
                  value={
                    itemId
                      ? (() => {
                          const selected = items.find((item) => item.id === itemId);
                          return selected
                            ? `${selected.product.name} · ${selected.brand?.name ?? 'بدون برند'}`
                            : itemQuery;
                        })()
                      : itemQuery
                  }
                  onChange={(event) => {
                    setItemQuery(event.target.value);
                    setItemId('');
                    setItemOpen(true);
                  }}
                  onFocus={() => setItemOpen(true)}
                  placeholder="نام کالا، برند، کد یا بارکد را جست‌وجو کنید"
                  role="combobox"
                  aria-expanded={itemOpen}
                  aria-controls="purchase-item-results"
                />
                {itemOpen && !itemId && itemQuery.trim() && (
                  <div className="purchase-item-results" id="purchase-item-results" role="listbox">
                    {visibleItems.slice(0, 30).map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        role="option"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          setItemId(item.id);
                          setItemQuery('');
                          setItemOpen(false);
                        }}
                      >
                        <strong>{item.product.name}</strong>
                        <span>
                          {item.brand?.name ?? 'بدون برند'} · کد {item.product.code || item.barcode}{' '}
                          · موجودی {formatPersianNumber(item.quantity)}
                        </span>
                      </button>
                    ))}
                    {!visibleItems.length && <p>قلمی با این عبارت پیدا نشد.</p>}
                    {visibleItems.length > 30 && (
                      <small>برای نمایش نتایج دقیق‌تر، عبارت جست‌وجو را کامل‌تر کنید.</small>
                    )}
                  </div>
                )}
              </div>
              {itemId && (
                <small className="purchase-selected-item">
                  قلم انتخاب‌شده؛ برای تغییر، متن را ویرایش کنید.
                </small>
              )}
              {fieldErrors.item && <small className="field-error">{fieldErrors.item}</small>}
            </label>
            <label>
              تعداد
              <FaNumberInput
                group={false}
                value={quantity}
                placeholder="۱"
                onChange={(plain) => setQuantity(plain)}
              />
              {fieldErrors.quantity && (
                <small className="field-error">{fieldErrors.quantity}</small>
              )}
            </label>
            <label>
              قیمت خرید واحد
              <FaNumberInput value={unitPrice} onChange={(plain) => setUnitPrice(plain)} />
              {fieldErrors.unitPrice && (
                <small className="field-error">{fieldErrors.unitPrice}</small>
              )}
            </label>
            <button type="button" onClick={addLine}>
              افزودن قلم
            </button>
          </div>
          {lines.length ? (
            <div className="purchase-lines">
              {lines.map((line) => (
                <article key={line.inventoryItemId}>
                  <strong>{line.productName}</strong>
                  <span>
                    {formatPersianNumber(line.quantity)} × {formatRial(Number(line.unitPrice))}
                  </span>
                  <b>{formatRial(Number(BigInt(line.quantity) * BigInt(line.unitPrice)))}</b>
                  <button
                    onClick={() =>
                      setLines(
                        lines.filter((item) => item.inventoryItemId !== line.inventoryItemId),
                      )
                    }
                  >
                    حذف
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="purchase-empty">هنوز قلمی به فاکتور اضافه نشده است.</div>
          )}
          <footer>
            <label>
              پرداخت اولیه
              <FaNumberInput value={paidAmount} onChange={(plain) => setPaidAmount(plain)} />
              {fieldErrors.paidAmount && (
                <small className="field-error">{fieldErrors.paidAmount}</small>
              )}
            </label>
            <div>
              <small>مانده پس از ثبت</small>
              <strong>
                {formatRial(Number(total - BigInt(/^\d+$/.test(paidAmount) ? paidAmount : 0)))}
              </strong>
            </div>
            <button disabled={loading || !lines.length} onClick={() => void submit()}>
              {loading ? 'در حال ثبت…' : 'ثبت خرید و افزایش موجودی'}
            </button>
          </footer>
        </div>
      )}
      <div className="purchase-toolbar">
        <label>
          فیلتر تأمین‌کننده
          <select
            value={supplierFilter}
            onChange={(event) => {
              setSupplierFilter(event.target.value);
              void loadPurchases(event.target.value);
            }}
          >
            <option value="">همهٔ تأمین‌کنندگان</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="product-table">
        <div className="table-head purchase-head">
          <span>شماره</span>
          <span>تأمین‌کننده</span>
          <span>مبلغ کل</span>
          <span>مانده</span>
          <span>تاریخ</span>
          <span>عملیات</span>
        </div>
        {purchases.map((purchase) => {
          const remaining = BigInt(purchase.total) - BigInt(purchase.paidAmount);
          return (
            <div className="table-row purchase-row" key={purchase.id}>
              <button className="purchase-number" onClick={() => void openDetail(purchase.id)}>
                <code>{formatPersianNumber(purchase.number)}</code>
              </button>
              <strong>{purchase.supplierName}</strong>
              <span>{formatRial(Number(purchase.total))}</span>
              <b className={remaining > 0n ? 'low-stock' : 'status-chip'}>
                {formatRial(Number(remaining))}
              </b>
              <small>{formatJalaliDate(purchase.issuedAt)}</small>
              <span className="row-actions">
                <button className="row-action" onClick={() => void openDetail(purchase.id)}>
                  جزئیات
                </button>
                {remaining > 0n && (
                  <button
                    className="row-action"
                    onClick={() => {
                      setPayFor(purchase);
                      setPaymentAmount('');
                    }}
                  >
                    پرداخت
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {payFor && (
        <div className="editor customer-payment">
          <div className="editor-head">
            <h2>ثبت پرداخت · {formatPersianNumber(payFor.number)}</h2>
            <button className="close" onClick={() => setPayFor(null)}>
              بستن
            </button>
          </div>
          <p>مانده: {formatRial(Number(BigInt(payFor.total) - BigInt(payFor.paidAmount)))}</p>
          <FaNumberInput
            value={paymentAmount}
            placeholder="مبلغ پرداختی به ریال"
            onChange={(plain) => setPaymentAmount(plain)}
          />
          <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
            {Object.entries(paymentLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {paymentMethod === 'credit' && (
            <div className="check-fields-v2">
              <div className="check-fields-v2-head">
                <div>
                  <b>جزئیات چک تأمین‌کننده</b>
                  <small>اطلاعات چک پرداختی را وارد کنید</small>
                </div>
                <span className="check-fields-v2-icon">🏦</span>
              </div>
              <div className="check-card">
                <div className="check-card-grid">
                  <label className="check-field">
                    <span>شماره چک</span>
                    <input
                      placeholder="مثلاً ۱۲۳۴۵۶۷۸۹"
                      value={supplierCheck.checkNumber}
                      onChange={(e) =>
                        setSupplierCheck({ ...supplierCheck, checkNumber: e.target.value })
                      }
                    />
                  </label>
                  <label className="check-field">
                    <span>بانک</span>
                    <input
                      placeholder="مثلاً ملی، ملت..."
                      value={supplierCheck.bank}
                      onChange={(e) =>
                        setSupplierCheck({ ...supplierCheck, bank: e.target.value })
                      }
                    />
                  </label>
                  <label className="check-field">
                    <span>شعبه</span>
                    <input
                      placeholder="نام یا کد شعبه"
                      value={supplierCheck.branch}
                      onChange={(e) =>
                        setSupplierCheck({ ...supplierCheck, branch: e.target.value })
                      }
                    />
                  </label>
                  <label className="check-field">
                    <span>تاریخ سررسید</span>
                    <JalaliDateInput
                      value={supplierCheck.dueDate}
                      onChange={(value) => setSupplierCheck({ ...supplierCheck, dueDate: value })}
                    />
                  </label>
                  <label className="check-field check-field-full">
                    <span>مبلغ چک (ریال)</span>
                    <FaNumberInput
                      value={supplierCheck.amount}
                      placeholder="مبلغ چک"
                      onChange={(plain) =>
                        setSupplierCheck({ ...supplierCheck, amount: plain })
                      }
                    />
                  </label>
                </div>
              </div>
            </div>
          )}
          <textarea
            value={paymentNotes}
            onChange={(event) => setPaymentNotes(event.target.value)}
            placeholder="توضیح پرداخت (اختیاری)"
          />
          <button disabled={loading} onClick={() => void pay()}>
            {loading ? 'در حال ثبت…' : 'ثبت پرداخت'}
          </button>
        </div>
      )}
      {detail && (
        <div className="editor purchase-detail">
          <div className="editor-head">
            <div>
              <span className="eyebrow">جزئیات فاکتور خرید</span>
              <h2>
                <code>{formatPersianNumber(detail.number)}</code>
              </h2>
            </div>
            <button className="close" onClick={() => setDetail(null)}>
              بستن
            </button>
          </div>
          <div className="purchase-detail-meta">
            <article>
              <small>تأمین‌کننده</small>
              <strong>{detail.supplierName}</strong>
            </article>
            <article>
              <small>مبلغ کل</small>
              <strong>{formatRial(Number(detail.total))}</strong>
            </article>
            <article>
              <small>مانده</small>
              <strong>
                {formatRial(
                  Number(detail.debt ?? BigInt(detail.total) - BigInt(detail.paidAmount)),
                )}
              </strong>
            </article>
          </div>
          <h3>اقلام خرید</h3>
          {detail.items?.map((item) => (
            <div className="purchase-detail-line" key={item.id}>
              <strong>{item.productName}</strong>
              <span>{formatPersianNumber(item.quantity)} عدد</span>
              <span>{formatRial(Number(item.unitPrice))}</span>
              <b>{formatRial(Number(item.lineTotal))}</b>
            </div>
          ))}
          <h3>پرداخت‌ها</h3>
          {detail.payments?.length ? (
            detail.payments.map((payment) => (
              <div className="purchase-detail-line" key={payment.id}>
                <strong>{paymentLabels[payment.method] ?? payment.method}</strong>
                <span>{formatRial(Number(payment.amount))}</span>
                <small>{formatJalaliDate(payment.paidAt, 'dateTime')}</small>
                {payment.check && (
                  <select
                    className="check-status-select"
                    value={payment.check.status}
                    onChange={(event) =>
                      void api(`/purchases/checks/${payment.check!.id}/status`, {
                        method: 'PATCH',
                        body: JSON.stringify({ status: event.target.value }),
                      })
                        .then(() => openDetail(detail.id))
                        .catch((error: Error) => setMessage(error.message))
                    }
                  >
                    <option value="pending">در انتظار</option>
                    <option value="cleared">وصول‌شده</option>
                    <option value="bounced">برگشتی</option>
                    <option value="cancelled">لغوشده</option>
                  </select>
                )}
              </div>
            ))
          ) : (
            <p className="muted">پرداختی ثبت نشده است.</p>
          )}
        </div>
      )}
    </section>
  );
}
