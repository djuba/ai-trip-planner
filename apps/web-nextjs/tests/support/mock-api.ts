// Answers the web app's API calls in Playwright with `page.route` (CLAUDE.md §6.3). The page on
// :3000 calls another origin, so the browser still applies CORS to fulfilled responses: every
// answer carries the headers the real API sends, and preflights are answered (WU-12 plan, fix 1).
// Bodies come from tests/support/fixtures.ts, which builds them through the wire schemas.
import type { Page, Route } from '@playwright/test';

export type MockAnswer =
  { status: number; json: unknown; headers?: Record<string, string> } | 'abort' | 'hang';

/** Keys are `<METHOD> <path>`, e.g. `GET /v1/health`. Any other API request fails the test. */
export type MockRoutes = Record<string, MockAnswer>;

const WEB_ORIGIN = 'http://localhost:3000';

const corsHeaders = {
  'access-control-allow-origin': WEB_ORIGIN,
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-expose-headers': 'retry-after',
  vary: 'Origin',
};

export async function mockApi(page: Page, baseUrl: string, routes: MockRoutes): Promise<void> {
  await page.route(`${baseUrl}/**`, async (route: Route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    const key = `${request.method()} ${new URL(request.url()).pathname}`;
    const answer = routes[key];
    if (answer === undefined) {
      await route.fulfill({ status: 599, headers: corsHeaders, body: `unmocked request: ${key}` });
      throw new Error(`mockApi: unmocked request ${key}`);
    }
    if (answer === 'abort') {
      await route.abort('connectionrefused');
      return;
    }
    if (answer === 'hang') return; // never answered: the request stays pending
    await route.fulfill({
      status: answer.status,
      headers: { ...corsHeaders, ...answer.headers },
      contentType: 'application/json',
      body: JSON.stringify(answer.json),
    });
  });
}
