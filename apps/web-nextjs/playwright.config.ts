import { defineConfig, devices } from '@playwright/test';

/**
 * Nothing listens here: every API call is answered by `page.route` with contract-valid fixtures
 * (CLAUDE.md §6.3). Next inlines it at build time, so the build gets it too (WU-12 plan D8).
 */
export const MOCK_API_BASE_URL = 'http://127.0.0.1:4999';

export default defineConfig({
  testDir: 'tests/functional',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Build then serve the real app. Env goes through `env`, never an inline chain (CLAUDE.md §3);
  // set values win over the root .env.local, which next.config.mjs never overrides.
  webServer: {
    command: 'pnpm build && pnpm start',
    url: 'http://localhost:3000',
    env: { NEXT_PUBLIC_API_BASE_URL: MOCK_API_BASE_URL, NEXT_TELEMETRY_DISABLED: '1' },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
