import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

/**
 * Renders a scannable barcode (EAN-13 when the value is a 13-digit number,
 * CODE128 otherwise) so a handheld scanner can read it straight off the
 * screen — the numeric string alone is not enough for hardware.
 */
export function BarcodeSvg({
  value,
  height = 52,
  className,
}: {
  value: string;
  height?: number;
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current || !value) return;
    const format = /^\d{13}$/.test(value) ? 'EAN13' : 'CODE128';
    try {
      JsBarcode(svgRef.current, value, {
        format,
        height,
        width: 2,
        fontSize: 14,
        margin: 6,
        font: 'monospace',
      });
    } catch {
      // Invalid value for the chosen format — fall back to CODE128.
      try {
        JsBarcode(svgRef.current, value, { format: 'CODE128', height, width: 2, fontSize: 14 });
      } catch {
        /* give up silently; the numeric text is still displayed next to it */
      }
    }
  }, [value, height]);

  return <svg ref={svgRef} className={className} />;
}
