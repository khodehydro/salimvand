export const APP_NAME = 'فروشگاه سلیم وند';
export const STORE_BRAND = 'فروشگاه آذین خودرو سلیم وند';
export const API_PREFIX = '/api/v1';

export type InventoryAvailability = 'in_stock' | 'low_stock' | 'out_of_stock' | 'coming_soon' | 'discontinued';
export type UserRole = 'super_admin' | 'manager' | 'seller' | 'warehouse' | 'accountant';

export function formatPersianNumber(value: number | string): string {
  return String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)] ?? digit);
}

export function formatRial(value: number): string {
  return `${formatPersianNumber(new Intl.NumberFormat('fa-IR').format(value))} ریال`;
}

export function createSlug(value: string): string {
  return value.trim().toLowerCase()
    .replace(/[\u200c\s]+/g, '-')
    .replace(/[^\u0600-\u06ff\u0041-\u005a\u0061-\u007a\u0030-\u0039-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function buildProductSeo(product: { name: string; categoryName?: string; vehicleNames?: string[]; slug?: string }) {
  const vehicles = product.vehicleNames?.slice(0, 3).join('، ');
  const context = vehicles ? ` مناسب ${vehicles}` : '';
  return {
    slug: product.slug ?? createSlug(`${product.name}${vehicles ? ` ${vehicles}` : ''}`),
    seoTitle: `${product.name}${context} | فروشگاه سلیم وند میاندوآب`,
    seoDescription: `معرفی و استعلام ${product.name}${context} از فروشگاه آذین خودرو سلیم وند در میاندوآب، آذربایجان غربی.`,
    seoKeywords: [product.name, ...(product.vehicleNames ?? []), 'سلیم وند', 'میاندوآب'],
  };
}

export function createEan13(seed: string): string {
  const digits = seed.replace(/\D/g, '').padStart(9, '0').slice(-9);
  const base = `626${digits}`;
  const sum = base.split('').reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return `${base}${(10 - (sum % 10)) % 10}`;
}

export function formatJalaliDate(
  dateInput: Date | string | number,
  mode: 'date' | 'time' | 'dateTime' = 'date'
): string {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(date.getTime())) return '';
  const options: Intl.DateTimeFormatOptions = mode === 'time'
    ? { hour: '2-digit', minute: '2-digit', hour12: false }
    : mode === 'dateTime'
    ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }
    : { year: 'numeric', month: '2-digit', day: '2-digit' };

  const formatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', options);
  return formatter.format(date);
}

