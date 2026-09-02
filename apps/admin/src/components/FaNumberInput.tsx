import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { formatGroupedPersian, formatPersianNumber, parseDigitsInput } from '@salimvand/shared';

type FaNumberInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange'
> & {
  /** Current plain ASCII digit string ('' when empty) — the same shape the old
   * type=number inputs held, so validation and API calls stay untouched. */
  value: string;
  /** Receives the plain ASCII digit string on every keystroke. */
  onChange: (plain: string) => void;
  /** Money fields group 3-digit chunks (۱٬۲۰۰٬۰۰۰); counts stay bare (۱۲). */
  group?: boolean;
};

const isPersianDigit = (char: string) => char >= '۰' && char <= '۹';

/**
 * Persian-digit numeric input. The operator always SEES Persian digits — with
 * optional 3-digit grouping for money — while the app RECEIVES plain ASCII
 * digits, exactly what the previous type=number inputs produced. Whatever the
 * keyboard throws at it (Persian/Arabic digits, ٬/,/. separators, spaces) is
 * normalized on the fly, so typing «۱٬۲۰۰٬۰۰۰» and «1200000» is equivalent.
 *
 * The displayed string is kept in a local draft while the field is focused so
 * parent-side transforms (clamping, Number() round-trips) never fight the
 * caret; on blur the display snaps back to the prop value.
 */
export function FaNumberInput({ value, onChange, group = true, ...rest }: FaNumberInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const caretRef = useRef<number | null>(null);
  const [draft, setDraft] = useState<string | null>(null);

  const format = (plain: string) =>
    group && plain ? formatGroupedPersian(plain) : formatPersianNumber(plain);

  // Restore the caret after React re-renders with the reformatted string:
  // it must sit right after the same Nth digit the caret was on before.
  useEffect(() => {
    if (draft === null || caretRef.current === null) return;
    const input = inputRef.current;
    const position = caretRef.current;
    caretRef.current = null;
    if (input) input.setSelectionRange(position, position);
  }, [draft]);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    const caret = event.target.selectionStart ?? raw.length;
    const digitsBeforeCaret = parseDigitsInput(raw.slice(0, caret)).length;
    const plain = parseDigitsInput(raw);
    const formatted = format(plain);
    let seen = 0;
    let position = 0;
    for (; position < formatted.length && seen < digitsBeforeCaret; position++) {
      if (isPersianDigit(formatted[position])) seen++;
    }
    caretRef.current = position;
    setDraft(formatted);
    onChange(plain);
  };

  return (
    <input
      {...rest}
      className={`fa-num-in${rest.className ? ` ${rest.className}` : ''}`}
      ref={inputRef}
      type="text"
      dir="ltr"
      inputMode="numeric"
      autoComplete="off"
      value={draft ?? format(value)}
      onFocus={() => setDraft(format(value))}
      onBlur={() => setDraft(null)}
      onChange={handleChange}
    />
  );
}
