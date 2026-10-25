'use client';
export default function MiniError({ reset }: { reset: () => void }) {
  return (
    <section className="mini-empty" role="alert">
      <h1>ارتباط با فروشگاه برقرار نشد</h1>
      <p>ممکن است اتصال اینترنت یا سرور موقتاً در دسترس نباشد. دوباره تلاش کن.</p>
      <button type="button" className="mini-primary" onClick={reset}>
        تلاش دوباره
      </button>
    </section>
  );
}
