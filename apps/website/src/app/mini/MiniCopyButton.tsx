'use client';
import { useState } from 'react';
import { MiniIcon } from './MiniIcon';

export function MiniCopyButton({ value, label }: { value: string; label: string }) {
  const [message, setMessage] = useState('');
  return (
    <div className="mini-copy-control">
      <button
        type="button"
        className="mini-secondary"
        onClick={async () => {
          try {
            if (!navigator.clipboard?.writeText) throw new Error('Unavailable');
            await navigator.clipboard.writeText(value);
            setMessage('کپی شد؛ می‌توانی در گفت‌وگو ارسال کنی.');
          } catch {
            setMessage(
              'کپی خودکار در این نسخه در دسترس نیست؛ متن نمایش‌داده‌شده را انتخاب و کپی کن.',
            );
          }
        }}
      >
        <MiniIcon name="copy" />
        {label}
      </button>
      {message && <small role="status">{message}</small>}
    </div>
  );
}
