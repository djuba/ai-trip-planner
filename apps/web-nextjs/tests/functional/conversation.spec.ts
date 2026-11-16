// The conversation screen top to bottom in a real browser, with the API mocked at the network
// edge (CLAUDE.md §6.3). Every state in AC-CONV-14 gets an axe scan. The date is fixed so
// `referenceDate` is predictable.
import { MAX_MESSAGE_LENGTH } from '@vp/domain-schema/wire';
import { expect, test, type Page } from '@playwright/test';
import { MOCK_API_BASE_URL } from '../../playwright.config.ts';
import { expectNoAxeViolations } from '../support/axe.ts';
import {
  childAgeClarificationResponse,
  errorBody,
  healthResponse,
  needsClarificationResponse,
  readyAfterCorrectionResponse,
} from '../support/fixtures.ts';
import { mockApi, type MockAnswer } from '../support/mock-api.ts';

const EXTRACT = 'POST /v1/trip/extract';
const ok = (json: unknown): MockAnswer => ({ status: 200, json });
const fail = (status: number, code: string, headers?: Record<string, string>): MockAnswer => ({
  status,
  json: errorBody(code, 'x'),
  ...(headers === undefined ? {} : { headers }),
});

async function open(page: Page, extract: MockAnswer | MockAnswer[], url = '/') {
  const mock = await mockApi(page, MOCK_API_BASE_URL, {
    'GET /v1/health': { status: 200, json: healthResponse() },
    [EXTRACT]: extract,
  });
  await page.clock.setFixedTime(new Date('2030-01-15T12:00:00'));
  await page.goto(url);
  return mock;
}

async function send(page: Page, text: string) {
  await page.getByLabel('Your message').fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
}

test('AC-CONV-01 AC-CONV-02 AC-CONV-03 AC-CONV-04 AC-CONV-14: the clarification loop', async ({
  page,
}) => {
  const { requests } = await open(page, [
    ok(childAgeClarificationResponse()),
    ok(readyAfterCorrectionResponse()),
  ]);
  const panel = page.getByRole('region', { name: 'Your trip so far' });
  await expect(panel).toContainText('Nothing yet');
  await expectNoAxeViolations(page);

  await send(page, 'Hawaii in February with my 19-year-old child');
  await expect(
    page.getByText('Is the 19-year-old traveling as an adult? <b>Tell me</b>'),
  ).toBeVisible();
  await expect(page.getByText('What needs fixing')).toBeVisible();
  await expect(
    page.getByText("A child's age must be from 0 to 17, but this traveler's age is 19."),
  ).toBeVisible();
  await expect(panel.getByText('Needs attention')).toBeVisible();
  await expect(page.getByLabel('Your message')).toHaveValue('');
  expect(requests[EXTRACT]?.[0]?.body).toEqual({
    message: 'Hawaii in February with my 19-year-old child',
    referenceDate: '2030-01-15',
  });
  await expectNoAxeViolations(page);

  await send(page, 'Yes, they are an adult');
  await expect(page.getByText('Your trip profile is ready.', { exact: false })).toBeVisible();
  await expect(panel.getByText('February 2030, 7 nights')).toBeVisible();
  await expect(panel.getByText('Needs attention')).toHaveCount(0);
  await expect(page.getByLabel('Your message')).toBeEnabled();
  expect(requests[EXTRACT]?.[1]?.body).toEqual({
    message: 'Yes, they are an adult',
    currentProfile: childAgeClarificationResponse().profile,
    referenceDate: '2030-01-15',
  });
  await expectNoAxeViolations(page);
});

test('AC-CONV-08 AC-CONV-14: shows Planning while a turn is in flight, and Start over clears it', async ({
  page,
}) => {
  await open(page, 'hang');
  await send(page, 'Somewhere warm');
  await expect(page.getByRole('region', { name: 'Conversation' }).getByRole('status')).toHaveText(
    'Planning…',
  );
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
  await expectNoAxeViolations(page);

  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.getByText('Planning…')).toHaveCount(0);
  await expect(page.getByText('Somewhere warm')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Your trip so far' })).toContainText('Nothing yet');
});

test('AC-CONV-07: counts code points and refuses one over the limit', async ({ page }) => {
  await open(page, ok(needsClarificationResponse()));
  const box = page.getByLabel('Your message');
  const sendButton = page.getByRole('button', { name: 'Send' });
  await box.fill('😀'.repeat(MAX_MESSAGE_LENGTH));
  await expect(page.getByText('0 characters left')).toBeVisible();
  await expect(sendButton).toBeEnabled();
  await box.fill('😀'.repeat(MAX_MESSAGE_LENGTH + 1));
  await expect(page.getByText("That's 1 character over the limit.")).toBeVisible();
  await expect(sendButton).toBeDisabled();
  await expect(box).not.toHaveAttribute('maxlength', /.*/);
});

test('AC-CONV-09 AC-CONV-14: Retry sends the same request again after an upstream error', async ({
  page,
}) => {
  const { requests } = await open(page, [
    fail(502, 'LLM_UPSTREAM_ERROR'),
    ok(childAgeClarificationResponse()),
  ]);
  await send(page, 'Hawaii please');
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    "The planner couldn't answer just now.",
  );
  await expectNoAxeViolations(page);

  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('What needs fixing')).toBeVisible();
  expect(requests[EXTRACT]).toHaveLength(2);
  expect(requests[EXTRACT]?.[1]?.body).toEqual(requests[EXTRACT]?.[0]?.body);
  await expect(page.getByText('Hawaii please')).toHaveCount(1);
});

test('AC-CONV-09: says the planner cannot be reached when the network fails', async ({ page }) => {
  await open(page, 'abort');
  await send(page, 'Hawaii please');
  await expect(page.getByRole('main').getByRole('alert')).toContainText("Can't reach the planner.");
});

test('AC-CONV-10 AC-CONV-14: asks for an invite code after a 401, then retries with it', async ({
  page,
}) => {
  const { requests } = await open(page, [
    fail(401, 'UNAUTHORIZED'),
    fail(401, 'UNAUTHORIZED'),
    ok(childAgeClarificationResponse()),
  ]);
  const code = page.getByRole('textbox', { name: 'Invite code' });
  await expect(code).toHaveCount(0);
  await send(page, 'Hawaii please');
  await expect(code).toBeVisible();
  await expectNoAxeViolations(page);

  await code.fill('wrong-code');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText("That code isn't valid");
  await expectNoAxeViolations(page);

  await code.fill('good-code');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('What needs fixing')).toBeVisible();
  const sent = requests[EXTRACT] ?? [];
  expect(sent).toHaveLength(3);
  expect(sent[2]?.headers['authorization']).toBe('Bearer good-code');
  expect(sent[2]?.body).toEqual(sent[0]?.body);
});

test('AC-CONV-11: an invite link stores its code and leaves the address bar', async ({ page }) => {
  const { requests } = await open(
    page,
    ok(childAgeClarificationResponse()),
    '/?invite=link-code&x=1',
  );
  await expect(page).toHaveURL(/\/\?x=1$/);
  await expect(page.getByRole('textbox', { name: 'Invite code' })).toHaveCount(0);
  await send(page, 'Hawaii please');
  await expect(page.getByText('What needs fixing')).toBeVisible();
  expect(requests[EXTRACT]?.[0]?.headers['authorization']).toBe('Bearer link-code');
});

test('AC-CONV-11: a link code that gets a 401 is called invalid', async ({ page }) => {
  await open(page, fail(401, 'UNAUTHORIZED'), '/?invite=link-code');
  await send(page, 'Hawaii please');
  await expect(page.getByText("That code isn't valid")).toBeVisible();
});

test('AC-CONV-12 AC-CONV-14: words rate limits, used-up invites and oversized messages', async ({
  page,
}) => {
  await open(page, [
    fail(429, 'RATE_LIMITED', { 'retry-after': '120' }),
    fail(429, 'QUOTA_EXHAUSTED'),
  ]);
  await send(page, 'Hawaii please');
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'Try again in about 2 minutes.',
  );
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'This invite has been used up.',
  );
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  await expectNoAxeViolations(page);
});

test('AC-CONV-12: says a 413 message is too long, with no Retry', async ({ page }) => {
  await open(page, fail(413, 'PAYLOAD_TOO_LARGE'));
  await send(page, 'Hawaii please');
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'That message is too long to send.',
  );
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
});
