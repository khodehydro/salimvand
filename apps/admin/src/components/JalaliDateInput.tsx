import { useMemo, useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
};

const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
function latinDigits(value: string) {
  return value.replace(/[۰-۹]/g, (digit) => String(persianDigits.indexOf(digit))).replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632));
}
function pad(value: number) { return String(value).padStart(2, '0'); }

function gregorianToJalali(iso: string) {
  if (!iso) return '';
  const [gy, gm, gd] = iso.split('-').map(Number);
  if (!gy || !gm || !gd) return '';
  const date = new Date(Date.UTC(gy, gm - 1, gd));
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date).replace(/-/g, '/');
}

// Jalali date conversion based on the well-known 2820-year Persian calendar cycle.
function jalaliToGregorian(input: string) {
  const normalized = latinDigits(input.trim()).replace(/[.\-]/g, '/');
  const parts = normalized.split('/').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) return '';
  let [jy, jm, jd] = parts;
  if (jy < 1000 || jm < 1 || jm > 12 || jd < 1 || jd > 31) return '';
  jy -= 979;
  const jDay = 365 * jy + Math.floor(jy / 33) * 8 + Math.floor((jy % 33 + 3) / 4) + jd - 1 + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gDay = jDay + 79;
  let gy = 1600 + 400 * Math.floor(gDay / 146097);
  gDay %= 146097;
  let leap = true;
  if (gDay >= 36525) {
    gDay--;
    gy += 100 * Math.floor(gDay / 36524);
    gDay %= 36524;
    if (gDay >= 365) gDay++;
    else leap = false;
  }
  gy += 4 * Math.floor(gDay / 1461);
  gDay %= 1461;
  if (gDay >= 366) { leap = false; gDay--; gy += Math.floor(gDay / 365); gDay %= 365; }
  const monthDays = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 1;
  while (gm <= 12 && gDay >= monthDays[gm]) { gDay -= monthDays[gm]; gm++; }
  const result = `${gy}-${pad(gm)}-${pad(gDay + 1)}`;
  const check = new Date(`${result}T00:00:00Z`);
  return Number.isNaN(check.getTime()) ? '' : result;
}

export function JalaliDateInput({ value, onChange, placeholder = '۱۴۰۵/۰۱/۰۱', ...props }: Props) {
  const formatted = useMemo(() => gregorianToJalali(value), [value]);
  const [draft, setDraft] = useState('');
  const display = draft || formatted;
  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      dir="ltr"
      value={display}
      placeholder={placeholder}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        const converted = jalaliToGregorian(next);
        if (converted) { onChange(converted); setDraft(''); }
        else if (!next.trim()) { onChange(''); setDraft(''); }
      }}
      onBlur={(event) => {
        const converted = jalaliToGregorian(event.target.value);
        if (converted) { onChange(converted); setDraft(''); }
        else if (!event.target.value.trim()) { onChange(''); setDraft(''); }
        props.onBlur?.(event);
      }}
    />
  );
}
