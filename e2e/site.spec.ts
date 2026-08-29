import { expect, test } from '@playwright/test';

test('public homepage renders the storefront shell', async ({ page }) => {
  await page.goto('/');
  // Brand and storefront header.
  await expect(page.locator('.site-header .brand-lockup')).toBeVisible();
  // Hero headline and the ever-present "no public price" note.
  await expect(page.getByRole('heading', { level: 1 })).toContainText('پیدا کن');
  // The catalog section and its filter bar exist.
  await expect(page.locator('.catalog-section')).toBeVisible();
  await expect(page.locator('.catalog-filters')).toBeVisible();
  // Contact block and footer.
  await expect(page.locator('.contact-section')).toBeVisible();
  await expect(page.locator('.site-footer')).toBeVisible();
});

test('public homepage never shows a unit price on product cards', async ({ page }) => {
  await page.goto('/');
  const cards = page.locator('.product-card');
  if ((await cards.count()) > 0) {
    // Price is internal data; if a card is present it must not render a price.
    await expect(page.getByText(/ریال|تومان/)).toHaveCount(0);
  }
});
