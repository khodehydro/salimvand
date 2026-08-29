import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke tests for the two user-facing surfaces:
 *   - the public Next.js catalog site (apps/website, port 3000)
 *   - the React/Vite admin panel (apps/admin, port 5173)
 *
 * The suite keeps running even when the API is down: both surfaces degrade
 * gracefully (the site shows an empty catalog, the panel shows the login form),
 * so these tests assert the shells render rather than depending on live data.
 * Real API/e2e coverage against a seeded database runs in CI after `build`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 45_000,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command:
        'API_URL=http://127.0.0.1:1/api/v1 PUBLIC_SITE_URL=http://127.0.0.1:1 pnpm --filter @salimvand/website start',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @salimvand/admin start',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
