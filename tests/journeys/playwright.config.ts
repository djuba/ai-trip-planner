import { defineConfig, devices } from '@playwright/test';

// No webServer: scripts/run-journeys.ts owns startup of the integrated stack and sets WEB_BASE_URL.
const baseURL = process.env.WEB_BASE_URL;
if (baseURL === undefined || baseURL === '') {
  throw new Error('WEB_BASE_URL is not set. Run the journeys with `pnpm test:journeys`.');
}

export default defineConfig({
  testDir: 'specs',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    timezoneId: 'UTC',
    locale: 'en-US',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
