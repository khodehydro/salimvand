import { expect, test } from '@playwright/test';

test('admin panel renders the login card when unauthenticated', async ({ page }) => {
  await page.goto('http://localhost:5173/');
  const card = page.locator('.login-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('سلیم وند');
  await expect(card.locator('input')).toHaveCount(2);
  await expect(card.getByRole('button', { name: 'ورود به پنل' })).toBeVisible();
});

test('admin panel blocks navigation to a protected page without a session', async ({ page }) => {
  await page.goto('http://localhost:5173/#analytics');
  // Without a refreshable session the panel stays on the login screen.
  await expect(page.locator('.login-card')).toBeVisible();
});
