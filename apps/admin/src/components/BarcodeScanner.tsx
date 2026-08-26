import { useRef, useState } from 'react';
import type { Html5Qrcode } from 'html5-qrcode';

export function BarcodeScanner({ onCode }: { onCode: (code: string) => void }) {
  const scanner = useRef<Html5Qrcode | null>(null); const [active, setActive] = useState(false); const [error, setError] = useState('');
  const start = async () => { if (active) return; setError(''); try { const { Html5Qrcode } = await import('html5-qrcode'); const instance = new Html5Qrcode('barcode-reader'); scanner.current = instance; setActive(true); await instance.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 120 } }, (code: string) => { onCode(code); void instance.stop(); setActive(false); }, () => undefined); } catch { setActive(false); setError('دسترسی به دوربین ممکن نیست یا اسکنر پشتیبانی نمی‌شود'); } };
  const stop = async () => { if (scanner.current) { await scanner.current.stop().catch(() => undefined); scanner.current = null; } setActive(false); };
  return <div className="scanner"><div id="barcode-reader" />{active ? <button className="outline" onClick={() => void stop()}>توقف اسکن</button> : <button onClick={() => void start()}>اسکن با دوربین</button>}{error && <small className="login-error">{error}</small>}</div>;
}
