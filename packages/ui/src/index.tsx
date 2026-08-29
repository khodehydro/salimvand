export * from './tokens';
export * from './components';
export * from './styles';
export { DesignSystemPreview, TokenGallery } from './preview';
export { designSystemCss as uiCss } from './styles';

import { designSystemCss } from './styles';

const STYLE_ELEMENT_ID = 'salimvand-design-system';

/**
 * Injects the design-system stylesheet once per document. Vite apps call this
 * from their entry file; Next.js apps get the same CSS through `ThemeProvider`.
 */
export function installDesignSystemCss(
  doc: Document = typeof document === 'undefined' ? (undefined as never) : document,
) {
  if (!doc || typeof doc.getElementById !== 'function') return null;
  if (doc.getElementById(STYLE_ELEMENT_ID)) return doc.getElementById(STYLE_ELEMENT_ID);
  const element = doc.createElement('style');
  element.id = STYLE_ELEMENT_ID;
  element.textContent = designSystemCss;
  doc.head.appendChild(element);
  return element;
}
