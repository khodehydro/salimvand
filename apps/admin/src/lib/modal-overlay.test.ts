import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the reported «پنجرهٔ ویرایش در پایین لیست ظاهر می‌شود و باید اسکرول
 * کنیم» bug. A stylesheet rule once turned `.modal-backdrop` into a static
 * block for the product page, so the editor dialog was laid out at the END
 * of the list instead of floating over it. The overlay must always be fixed
 * and the dialog must scroll internally.
 */
const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');

type Rule = { selector: string; body: string };

/** Minimal stylesheet parser: flattens @media/@supports into plain rules. */
function parseRules(source: string): Rule[] {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  let index = 0;
  while (index < clean.length) {
    const brace = clean.indexOf('{', index);
    if (brace === -1) break;
    const selector = clean.slice(index, brace).trim();
    let depth = 1;
    let cursor = brace + 1;
    while (cursor < clean.length && depth > 0) {
      if (clean[cursor] === '{') depth += 1;
      else if (clean[cursor] === '}') depth -= 1;
      cursor += 1;
    }
    const body = clean.slice(brace + 1, cursor - 1);
    if (selector.startsWith('@media') || selector.startsWith('@supports')) {
      rules.push(...parseRules(body));
    } else if (selector) {
      rules.push({ selector, body });
    }
    index = cursor;
  }
  return rules;
}

const rules = parseRules(css);
const bodiesFor = (pattern: RegExp) =>
  rules.filter((rule) => pattern.test(rule.selector)).map((rule) => rule.body);

describe('editor dialog overlay', () => {
  it('never pins the overlay into the page flow (position: static)', () => {
    // Rules whose selector ends in the overlay itself — the wrapper that must
    // stay fixed over the whole viewport.
    const overlayRules = rules.filter((rule) =>
      /(^|[\s>+~])\.modal-backdrop\s*$/.test(rule.selector),
    );
    expect(overlayRules.length).toBeGreaterThan(0);
    expect(overlayRules.some((rule) => /position:\s*fixed/.test(rule.body))).toBe(true);
    for (const rule of overlayRules) {
      expect(rule.body, `selector: ${rule.selector}`).not.toMatch(/position:\s*static/);
    }
  });

  it('lets the dialog scroll internally instead of the page', () => {
    const dialogBodies = bodiesFor(/\.modal-backdrop\s+\.editor(?![\w-])/);
    expect(dialogBodies.length).toBeGreaterThan(0);
    expect(dialogBodies.some((body) => /max-height:/.test(body))).toBe(true);
    expect(dialogBodies.some((body) => /overflow:\s*hidden/.test(body))).toBe(true);
    expect(bodiesFor(/^\.editor-body$/).some((body) => /overflow-y:\s*auto/.test(body))).toBe(true);
  });

  it('keeps the dialog head, tabs and footer pinned while the body scrolls', () => {
    const pinned = bodiesFor(/\.modal-backdrop\s+\.(editor-head|tabs|editor-footer)/);
    expect(pinned.length).toBeGreaterThan(0);
    expect(pinned.some((body) => /flex:\s*0 0 auto/.test(body))).toBe(true);
  });
});
