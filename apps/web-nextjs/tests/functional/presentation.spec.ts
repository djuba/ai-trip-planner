// From a ready profile to streamed recommendation cards, in a real browser (CLAUDE.md §6.3).
// `/present` is streamed for real by tests/support/stream-server.ts (WU-14 plan D9), so a test can
// pause mid-card and break the connection partway. Every state in AC-CARDS-13 gets an axe scan.
import { expect, test, type Page } from '@playwright/test';
import { MOCK_API_BASE_URL } from '../../playwright.config.ts';
import { expectNoAxeViolations } from '../support/axe.ts';
import {
  emptyPresentation,
  emptyRecommendResponse,
  healthResponse,
  readyResponse,
  tripPresentation,
  tripRecommendResponse,
  tripRecommendWithConcernsResponse,
} from '../support/fixtures.ts';
import { mockApi, type MockAnswer } from '../support/mock-api.ts';
import { chunkText, startStreamServer, type StreamServer } from '../support/stream-server.ts';

const RECOMMEND = 'POST /v1/trip/recommend';
const PRESENT = 'POST /v1/trip/present';
const ok = (json: unknown): MockAnswer => ({ status: 200, json });

let streams: StreamServer;
test.beforeEach(async () => {
  streams = await startStreamServer();
});
test.afterEach(async () => {
  await streams.close();
});

async function openAtReady(page: Page, recommend: MockAnswer, presentCalls = 1) {
  const mock = await mockApi(page, MOCK_API_BASE_URL, {
    'GET /v1/health': ok(healthResponse()),
    'POST /v1/trip/extract': ok(readyResponse()),
    [RECOMMEND]: recommend,
    [PRESENT]: Array.from({ length: presentCalls }, () => ({ continueTo: streams.url })),
  });
  await page.clock.setFixedTime(new Date('2030-01-15T12:00:00'));
  await page.goto('/');
  await page.getByLabel('Your message').fill('A week in Hawaii in February, two adults');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Your trip profile is ready.', { exact: false })).toBeVisible();
  return mock;
}

const results = (page: Page) => page.getByRole('region', { name: /Hawaiian|Recommendations/ });

test('AC-CARDS-01 AC-CARDS-02 AC-CARDS-03 AC-CARDS-04 AC-CARDS-05 AC-CARDS-13: cards stream in, with badges after each blurb', async ({
  page,
}) => {
  const text = JSON.stringify(tripPresentation());
  // Stop partway through the first card's blurb: "Calm tur".
  const cut = text.indexOf('Calm turquoise') + 'Calm tur'.length;
  streams.serve({ chunks: [text.slice(0, cut), ...chunkText(text.slice(cut), 40)], pauseAfter: 1 });
  const { requests } = await openAtReady(page, ok(tripRecommendResponse()));

  await page.getByRole('button', { name: 'Get recommendations' }).click();
  await expect(page.getByText('Writing up your trips…')).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Two calm Hawaiian beach weeks' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 3, name: 'Maui: beaches and turtles' }),
  ).toBeVisible();
  await expect(page.getByText('Calm tur', { exact: true })).toBeVisible();
  // The first card's blurb isn't done, so its claims and badges are held back (AC-CARDS-04).
  await expect(results(page).getByText('Unverified')).toHaveCount(0);
  await expect(results(page).getByText('From sample route data')).toHaveCount(0);
  await expect(results(page).getByRole('list').first()).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
  await expectNoAxeViolations(page);

  streams.release();
  await expect(page.getByText('Your recommendations are ready.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'Kauai: quiet reefs' })).toBeVisible();
  await expect(page.getByText('Non-stop flights run from MSP to OGG.')).toBeVisible();
  await expect(results(page).getByText('From sample route data', { exact: true })).toHaveCount(1);
  await expect(results(page).getByText('Unverified', { exact: true })).toHaveCount(2);
  await expect(page.getByText(/no live flight or hotel data/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Get recommendations' })).toHaveCount(0);

  expect(requests[RECOMMEND]?.[0]?.body).toEqual({
    profile: readyResponse().profile,
    referenceDate: '2030-01-15',
  });
  expect(requests[PRESENT]?.[0]?.body).toEqual({
    profile: readyResponse().profile,
    recommendations: tripRecommendResponse().recommendations,
  });
  expect(requests[PRESENT]?.[0]?.headers['content-type']).toBe('application/json');
  await expectNoAxeViolations(page);
});

test('AC-CARDS-10 AC-CARDS-13: says it is finding trips while /recommend runs', async ({
  page,
}) => {
  await openAtReady(page, 'hang', 0);
  await page.getByRole('button', { name: 'Get recommendations' }).click();
  await expect(page.getByText('Finding trips…')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
  await expectNoAxeViolations(page);
});

test('AC-CARDS-06 AC-CARDS-13: a stream that breaks partway can be retried without /recommend', async ({
  page,
}) => {
  const text = JSON.stringify(tripPresentation());
  streams.serve({ chunks: chunkText(text.slice(0, 200), 40), end: 'destroy' });
  const { requests } = await openAtReady(page, ok(tripRecommendResponse()), 2);

  await page.getByRole('button', { name: 'Get recommendations' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'The suggestions stopped partway.',
  );
  await expect(page.getByRole('heading', { level: 3 })).toHaveCount(0);
  await expectNoAxeViolations(page);

  streams.serve({ chunks: chunkText(text, 40) });
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('Your recommendations are ready.')).toBeVisible();
  expect(requests[RECOMMEND]).toHaveLength(1);
  expect(requests[PRESENT]).toHaveLength(2);
  expect(requests[PRESENT]?.[1]?.body).toEqual(requests[PRESENT]?.[0]?.body);
});

test('AC-CARDS-08 AC-CARDS-13: notes the critic still had concerns', async ({ page }) => {
  streams.serve({ chunks: chunkText(JSON.stringify(tripPresentation()), 60) });
  await openAtReady(page, ok(tripRecommendWithConcernsResponse()));
  await page.getByRole('button', { name: 'Get recommendations' }).click();
  await expect(page.getByText('Your recommendations are ready.')).toBeVisible();
  await expect(page.getByText(/own checks still had concerns/)).toBeVisible();
  await expect(page.getByText('The nightly price may be out of date.')).toHaveCount(0);
  await expectNoAxeViolations(page);
});

test('AC-CARDS-09 AC-CARDS-13: zero recommendations say nothing matched', async ({ page }) => {
  streams.serve({ chunks: chunkText(JSON.stringify(emptyPresentation()), 20) });
  await openAtReady(page, ok(emptyRecommendResponse()));
  await page.getByRole('button', { name: 'Get recommendations' }).click();
  await expect(
    page.getByText('No trips matched this profile. Try changing a detail.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'No trips to show' })).toBeVisible();
  await expectNoAxeViolations(page);
});
