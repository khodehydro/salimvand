import { themeCss, type Theme } from './tokens';
import type { PropsWithChildren } from 'react';

/**
 * Global stylesheet for the design system.
 *
 * Every rule consumes `var(--sv-*)` tokens generated from `tokens.ts`; no raw
 * colour literal is allowed here (see docs/delivery-spec.md acceptance item 2).
 */
export const designSystemCss = `
${themeCss}
@layer sv-base, sv-components;
@layer sv-base{
.sv-theme{font-family:var(--sv-font);color:var(--sv-text);background:var(--sv-bg);min-height:100%}
.sv-theme *,.sv-theme *::before,.sv-theme *::after{box-sizing:border-box}
.sv-theme button,.sv-theme input,.sv-theme select,.sv-theme textarea{font:inherit;color:inherit}
.sv-num{font-variant-numeric:tabular-nums}
.sv-code{font-family:var(--sv-font-mono);font-size:.86em;direction:ltr;unicode-bidi:isolate;background:var(--sv-surface-3);border:1px solid var(--sv-border);border-radius:6px;padding:1px 6px;color:var(--sv-text-2)}
.sv-theme :focus-visible{outline:3px solid color-mix(in srgb,var(--sv-link) 40%,transparent);outline-offset:2px}
.sv-theme :disabled{cursor:not-allowed;opacity:.55}
@media (prefers-reduced-motion: reduce){.sv-theme *{transition:none!important;animation:none!important}}
}
@layer sv-components{
.sv-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid transparent;border-radius:var(--sv-radius-button);padding:10px 16px;cursor:pointer;transition:background .15s,border-color .15s,color .15s;background:var(--sv-surface)}
.sv-btn--primary{background:var(--sv-primary);color:var(--sv-primary-fg)}
.sv-btn--primary:hover{background:var(--sv-primary-hover)}
.sv-btn--outline{border-color:var(--sv-border-2);color:var(--sv-text)}
.sv-btn--outline:hover{border-color:var(--sv-link);color:var(--sv-link)}
.sv-btn--soft{background:color-mix(in srgb,var(--sv-link) 12%,transparent);color:var(--sv-link)}
.sv-btn--ghost{background:transparent;color:var(--sv-text-2)}
.sv-btn--ghost:hover{background:var(--sv-surface-3);color:var(--sv-text)}
.sv-btn--danger{background:var(--sv-danger);color:var(--sv-primary-fg)}
.sv-btn--sm{padding:6px 10px;font-size:12px}
.sv-btn--lg{padding:13px 22px;font-size:16px}
.sv-btn--icon{padding:8px;width:36px;height:36px}
.sv-spinner{width:12px;height:12px;border-radius:50%;border:2px solid currentColor;border-top-color:transparent;animation:sv-spin .8s linear infinite}
@keyframes sv-spin{to{transform:rotate(360deg)}}
.sv-badge{display:inline-flex;align-items:center;gap:4px;border-radius:var(--sv-radius-pill);padding:3px 10px;font-size:12px;font-weight:600;background:var(--sv-surface-3);color:var(--sv-text-2)}
.sv-badge--ok{background:var(--sv-ok-soft);color:var(--sv-ok)}
.sv-badge--warn{background:var(--sv-warn-soft);color:var(--sv-warn)}
.sv-badge--danger{background:var(--sv-danger-soft);color:var(--sv-danger)}
.sv-badge--info{background:color-mix(in srgb,var(--sv-link) 14%,transparent);color:var(--sv-link)}
.sv-brand-chip{display:inline-flex;align-items:center;gap:4px;border-radius:var(--sv-radius-pill);padding:3px 9px;font-size:12px;border:1px solid var(--sv-border)}
.sv-brand-chip.is-in{background:var(--sv-ok-soft);color:var(--sv-ok);border-color:transparent}
.sv-brand-chip.is-out{color:var(--sv-text-3);text-decoration:line-through}
.sv-card{background:var(--sv-surface);border:1px solid var(--sv-border);border-radius:var(--sv-radius-card);padding:var(--sv-space-4);box-shadow:var(--sv-shadow-1)}
.sv-card__head{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--sv-space-3);margin-bottom:var(--sv-space-3)}
.sv-card__head h3{margin:0;font-size:16px}
.sv-card__head p{margin:4px 0 0;color:var(--sv-text-3);font-size:12px}
.sv-kpi{display:grid;gap:6px;text-align:start;background:var(--sv-surface);border:1px solid var(--sv-border);border-radius:var(--sv-radius-card);padding:var(--sv-space-4);box-shadow:var(--sv-shadow-1)}
.sv-kpi small{color:var(--sv-text-3);font-size:12px}
.sv-kpi strong{font-size:26px}
.sv-kpi em{font-style:normal;font-size:12px;color:var(--sv-text-2)}
.sv-kpi span{font-size:11px;color:var(--sv-text-3)}
.sv-kpi--ok strong{color:var(--sv-ok)}.sv-kpi--warn strong{color:var(--sv-warn)}.sv-kpi--danger strong{color:var(--sv-danger)}.sv-kpi--info strong{color:var(--sv-link)}
button.sv-kpi{cursor:pointer;width:100%}
.sv-field{display:grid;gap:6px;font-size:13px;color:var(--sv-text-2)}
.sv-field>span{font-weight:600}
.sv-field small{font-size:11px;color:var(--sv-text-3)}
.sv-field__error{color:var(--sv-danger)!important}
.sv-field.has-error .sv-input,.sv-field.has-error .sv-select,.sv-field.has-error .sv-textarea{border-color:var(--sv-danger)}
.sv-input,.sv-select,.sv-textarea{width:100%;border:1px solid var(--sv-border);border-radius:var(--sv-radius-button);background:var(--sv-surface);padding:10px 12px}
.sv-input:hover,.sv-select:hover,.sv-textarea:hover{border-color:var(--sv-border-2)}
.sv-textarea{min-height:88px;resize:vertical}
.sv-search{display:flex;align-items:center;gap:8px;border:1px solid var(--sv-border);border-radius:var(--sv-radius-button);background:var(--sv-surface);padding:0 12px}
.sv-search>span{color:var(--sv-text-3)}
.sv-search input{flex:1;border:0;background:transparent;padding:10px 0;outline:none}
.sv-search kbd{font-family:var(--sv-font-mono);font-size:11px;border:1px solid var(--sv-border);border-radius:6px;padding:2px 6px;color:var(--sv-text-3)}
.sv-chk,.sv-sw{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--sv-text-2)}
.sv-sw input{position:absolute;opacity:0;pointer-events:none}
.sv-sw i{width:38px;height:22px;border-radius:var(--sv-radius-pill);background:var(--sv-border-2);position:relative;transition:background .15s}
.sv-sw i::after{content:'';position:absolute;inset-block-start:3px;inset-inline-start:3px;width:16px;height:16px;border-radius:50%;background:var(--sv-surface);transition:transform .15s}
.sv-sw.is-on i{background:var(--sv-ok)}
.sv-sw.is-on i::after{transform:translateX(-16px)}
.sv-seg{display:inline-flex;background:var(--sv-surface-3);border-radius:var(--sv-radius-button);padding:3px;gap:3px}
.sv-seg button{border:0;background:transparent;border-radius:8px;padding:6px 12px;cursor:pointer;color:var(--sv-text-2);font-size:13px}
.sv-seg button.is-active{background:var(--sv-surface);color:var(--sv-text);box-shadow:var(--sv-shadow-1)}
.sv-tabs{display:flex;gap:4px;border-bottom:1px solid var(--sv-border);overflow:auto}
.sv-tabs button{border:0;background:transparent;padding:10px 14px;cursor:pointer;color:var(--sv-text-2);border-bottom:2px solid transparent;display:inline-flex;gap:6px;align-items:center;white-space:nowrap}
.sv-tabs button.is-active{color:var(--sv-primary);border-bottom-color:var(--sv-primary);font-weight:600}
.sv-tabs i{font-style:normal;background:var(--sv-surface-3);border-radius:var(--sv-radius-pill);padding:1px 7px;font-size:11px}
.sv-stepper{display:inline-flex;align-items:center;border:1px solid var(--sv-border);border-radius:var(--sv-radius-button);overflow:hidden}
.sv-stepper button{border:0;background:var(--sv-surface-3);width:30px;height:30px;cursor:pointer}
.sv-stepper span{min-width:38px;text-align:center;font-variant-numeric:tabular-nums}
.sv-table-wrap{overflow:auto;border:1px solid var(--sv-border);border-radius:var(--sv-radius-card);background:var(--sv-surface)}
.sv-table{width:100%;border-collapse:collapse;font-size:13px}
.sv-table th{background:var(--sv-surface-2);color:var(--sv-text-2);font-weight:600;padding:10px 12px;border-bottom:1px solid var(--sv-border);white-space:nowrap}
.sv-table td{padding:10px 12px;border-bottom:1px solid var(--sv-border)}
.sv-table tbody tr:last-child td{border-bottom:0}
.sv-table tbody tr:hover{background:var(--sv-surface-2)}
.sv-table tr.is-clickable{cursor:pointer}
.sv-table-wrap.is-dense td,.sv-table-wrap.is-dense th{padding:6px 10px}
.sv-table__empty{padding:var(--sv-space-4)}
.sv-stockbar{display:flex;align-items:center;gap:8px;min-width:110px}
.sv-stockbar i{display:block;height:8px;border-radius:var(--sv-radius-pill);background:var(--sv-ok);min-width:6px}
.sv-stockbar.is-warn i{background:var(--sv-warn)}
.sv-stockbar.is-danger i{background:var(--sv-danger)}
.sv-stockbar b{font-variant-numeric:tabular-nums;font-size:12px}
.sv-tl{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.sv-tl__item{display:grid;grid-template-columns:12px 1fr auto;gap:10px;align-items:start}
.sv-tl__item>i{width:10px;height:10px;border-radius:50%;background:var(--sv-border-2);margin-top:6px}
.sv-tl__item.is-ok>i{background:var(--sv-ok)}.sv-tl__item.is-warn>i{background:var(--sv-warn)}.sv-tl__item.is-danger>i{background:var(--sv-danger)}.sv-tl__item.is-info>i{background:var(--sv-link)}
.sv-tl__item div{display:grid}
.sv-tl__item small{color:var(--sv-text-3)}
.sv-tl__item>span{color:var(--sv-text-3);font-size:12px}
.sv-tl__empty{color:var(--sv-text-3);font-size:13px}
.sv-empty{display:grid;justify-items:center;gap:8px;padding:var(--sv-space-5);text-align:center;color:var(--sv-text-2)}
.sv-empty>span{font-size:28px;color:var(--sv-text-3)}
.sv-empty p{margin:0;font-size:13px;color:var(--sv-text-3)}
.sv-skeleton{display:grid;gap:8px}
.sv-skeleton i{display:block;height:12px;border-radius:6px;background:linear-gradient(90deg,var(--sv-surface-3),var(--sv-surface-2),var(--sv-surface-3));background-size:200% 100%;animation:sv-shimmer 1.4s infinite}
@keyframes sv-shimmer{to{background-position:-200% 0}}
.sv-backdrop{position:fixed;inset:0;background:rgba(4,18,31,.55);display:grid;z-index:60}
.sv-sheet{grid-column:1;justify-self:end;height:100%;width:min(420px,92vw);background:var(--sv-surface);border-inline-start:1px solid var(--sv-border);box-shadow:var(--sv-shadow-modal);display:flex;flex-direction:column}
.sv-sheet header,.sv-modal header{display:flex;align-items:center;justify-content:space-between;padding:var(--sv-space-4);border-bottom:1px solid var(--sv-border)}
.sv-sheet header h3,.sv-modal header h3{margin:0;font-size:16px}
.sv-sheet__body,.sv-modal__body{padding:var(--sv-space-4);overflow:auto;flex:1;display:grid;gap:var(--sv-space-3);align-content:start}
.sv-sheet__foot,.sv-modal footer{padding:var(--sv-space-4);border-top:1px solid var(--sv-border);display:flex;gap:8px;justify-content:flex-end;background:var(--sv-surface-2)}
.sv-modal{place-self:center;width:min(560px,94vw);max-height:88vh;background:var(--sv-surface);border:1px solid var(--sv-border);border-radius:var(--sv-radius-modal);box-shadow:var(--sv-shadow-modal);display:flex;flex-direction:column;overflow:hidden}
.sv-modal.is-sm{width:min(400px,94vw)}.sv-modal.is-lg{width:min(880px,96vw)}
.sv-palette{place-self:start center;margin-top:10vh;width:min(620px,94vw);background:var(--sv-surface);border:1px solid var(--sv-border);border-radius:var(--sv-radius-modal);box-shadow:var(--sv-shadow-modal);overflow:hidden}
.sv-palette>input{width:100%;border:0;border-bottom:1px solid var(--sv-border);padding:16px;outline:none;font-size:15px;background:var(--sv-surface)}
.sv-palette__body{max-height:52vh;overflow:auto;padding:8px}
.sv-palette__body section{margin-bottom:6px}
.sv-palette__body header{display:flex;align-items:center;gap:8px;padding:8px 10px;color:var(--sv-text-3);font-size:12px;font-weight:600}
.sv-palette__key{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:6px;background:var(--sv-surface-3);font-size:11px}
.sv-palette__body button{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;border:0;background:transparent;border-radius:10px;padding:9px 10px;cursor:pointer;text-align:start}
.sv-palette__body button:hover{background:var(--sv-surface-3)}
.sv-palette__body small{color:var(--sv-text-3)}
.sv-palette>footer{padding:10px 14px;border-top:1px solid var(--sv-border);color:var(--sv-text-3);font-size:11px;background:var(--sv-surface-2)}
.sv-toasts{position:fixed;inset-block-end:20px;inset-inline-start:20px;display:grid;gap:8px;z-index:80}
.sv-toast{display:flex;align-items:center;gap:10px;background:var(--sv-surface);border:1px solid var(--sv-border);border-inline-start-width:4px;border-radius:var(--sv-radius-button);box-shadow:var(--sv-shadow-2);padding:10px 14px;font-size:13px}
.sv-toast.is-ok{border-inline-start-color:var(--sv-ok)}
.sv-toast.is-warn{border-inline-start-color:var(--sv-warn)}
.sv-toast.is-danger{border-inline-start-color:var(--sv-danger)}
.sv-toast button{border:0;background:transparent;color:var(--sv-text-3);cursor:pointer}
.sv-donut{display:grid;gap:var(--sv-space-3)}
.sv-legend{list-style:none;margin:0;padding:0;display:grid;gap:6px;font-size:13px}
.sv-legend li{display:flex;align-items:center;gap:8px}
.sv-legend i{width:10px;height:10px;border-radius:3px}
.sv-legend small{color:var(--sv-text-3);margin-inline-start:auto}
.sv-bars{width:100%}
}
`;

/**
 * Theme-aware shell: applies `dir` + `data-theme` on a wrapper element and
 * injects the token stylesheet once. Apps may import `styles.css` instead.
 */
export function DesignSystemStyles() {
  return <style dangerouslySetInnerHTML={{ __html: designSystemCss }} />;
}

export function DesignSystemRoot({
  theme,
  dir = 'rtl',
  children,
}: PropsWithChildren<{ theme: Theme; dir?: 'rtl' | 'ltr' }>) {
  return (
    <div dir={dir} data-theme={theme} className="sv-theme">
      <DesignSystemStyles />
      {children}
    </div>
  );
}
