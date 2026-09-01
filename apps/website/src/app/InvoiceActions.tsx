'use client';

import { useState } from 'react';

/**
 * The public invoice document is a server component (it awaits the QR data
 * URL), so the print/copy triggers must live in their own client island.
 * `variant="band"` renders on the dark header band, `variant="foot"` on the
 * bottom action row (with an optional copy-link button).
 */
export function InvoiceActions({
  pdfHref,
  variant = 'band',
  copyUrl,
}: {
  pdfHref: string;
  variant?: 'band' | 'foot';
  copyUrl?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="invoice-actions">
      {variant === 'foot' ? (
        <>
          <a className="ia ia-primary" href={pdfHref} target="_blank" rel="noreferrer">
            دانلود PDF
          </a>
          <button
            className="ia ia-outline"
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') window.print();
            }}
          >
            چاپ
          </button>
          {copyUrl && (
            <button
              className="ia ia-ghost"
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(copyUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? 'لینک کپی شد ✓' : 'کپی لینک'}
            </button>
          )}
        </>
      ) : (
        <>
          <button
            className="ia ia-outline-white"
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') window.print();
            }}
          >
            چاپ
          </button>
          <a className="ia ia-white" href={pdfHref} target="_blank" rel="noreferrer">
            دانلود PDF
          </a>
        </>
      )}
    </div>
  );
}
