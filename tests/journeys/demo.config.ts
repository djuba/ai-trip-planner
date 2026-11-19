import { defineConfig, devices } from '@playwright/test';

// The README demo recording (`pnpm record:demo`), not a test: no gate runs this config, and the
// journeys' own config only looks in specs/. scripts/run-journeys.ts starts the stack in replay
// mode, as for the journeys, and sets WEB_BASE_URL.
const baseURL = process.env.WEB_BASE_URL;
if (baseURL === undefined || baseURL === '') {
  throw new Error('WEB_BASE_URL is not set. Record the demo with `pnpm record:demo`.');
}

// Tall enough that Get recommendations is on screen once the profile is ready.
const size = { width: 1100, height: 900 };

export default defineConfig({
  testDir: 'demo',
  testMatch: '**/*.demo.ts',
  outputDir: 'demo-results',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  use: {
    baseURL,
    timezoneId: 'UTC',
    locale: 'en-US',
    viewport: size,
    video: { mode: 'on', size },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: size } }],
});
