// Answers the web app's API calls in Playwright with `page.route` (CLAUDE.md §6.3). The page on
// :3000 calls another origin, so the browser still applies CORS to fulfilled responses: every
// answer carries the headers the real API sends, and preflights are answered (WU-12 plan, fix 1).
// Bodies come from tests/support/fixtures.ts, which builds them through the wire schemas.
//
// A route's answer may be one answer or an array, consumed in order per key (WU-13 plan D9); a
// request past the end fails like an unmocked one. `mockApi` returns every non-OPTIONS request it
// saw (parsed JSON body and headers), keyed like the routes, so tests can assert what was sent.
import type { Page, Route } from '@playwright/test';

export type MockAnswer =
  { status: number; json: unknown; headers?: Record<string, string> } | 'abort' | 'hang';

/** Keys are `<METHOD> <path>`, e.g. `GET /v1/health`. Any other API request fails the test. */
export type MockRoutes = Record<string, MockAnswer | MockAnswer[]>;

export interface RecordedRequest {
  body: unknown;
  headers: Record<string, string>;
}

const WEB_ORIGIN = 'http://localhost:3000';

const corsHeaders = {
  'access-control-allow-origin': WEB_ORIGIN,
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-expose-headers': 'retry-after',
  vary: 'Origin',
};

export async function mockApi(
  page: Page,
  baseUrl: string,
  routes: MockRoutes,
): Promise<{ requests: Record<string, RecordedRequest[]> }> {
  const requests: Record<string, RecordedRequest[]> = {};
  const used: Record<string, number> = {};
  await page.route(`${baseUrl}/**`, async (route: Route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    const key = `${request.method()} ${new URL(request.url()).pathname}`;
    const text = request.postData();
    (requests[key] ??= []).push({
      body: text === null ? undefined : (JSON.parse(text) as unknown),
      headers: request.headers(),
    });
    const entry = routes[key];
    if (entry === undefined) {
      await route.fulfill({ status: 599, headers: corsHeaders, body: `unmocked request: ${key}` });
      throw new Error(`mockApi: unmocked request ${key}`);
    }
    let answer: MockAnswer | undefined;
    if (Array.isArray(entry)) {
      const index = used[key] ?? 0;
      used[key] = index + 1;
      answer = entry[index];
      if (answer === undefined) {
        await route.fulfill({ status: 599, headers: corsHeaders, body: `no more answers: ${key}` });
        throw new Error(`mockApi: no more answers for ${key}`);
      }
    } else {
      answer = entry;
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
  return { requests };
}
