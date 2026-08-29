'use client';

/**
 * The public invoice document is a server component (it awaits the QR data
 * URL), so the print trigger must live in its own client island.
 */
export function InvoiceActions({ pdfHref }: { pdfHref: string }) {
  return (
    <div className="invoice-actions">
      <button
        type="button"
        onClick={() => {
          if (typeof window !== 'undefined') window.print();
        }}
      >
        چاپ
      </button>
      <a href={pdfHref} target="_blank" rel="noreferrer">
        دانلود PDF
      </a>
    </div>
  );
}
