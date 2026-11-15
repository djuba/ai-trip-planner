// The shell, top to bottom in a real browser, with the API mocked at the network edge
// (CLAUDE.md §6.3). Every state gets an axe scan. The status is looked up in the footer, because
// the conversation has its own loading status (WU-13 plan D10).
import { expect, test } from '@playwright/test';
import { MOCK_API_BASE_URL } from '../../playwright.config.ts';
import { expectNoAxeViolations } from '../support/axe.ts';
import { errorBody, healthResponse } from '../support/fixtures.ts';
import { mockApi } from '../support/mock-api.ts';

test('AC-WEB-12: shows the API as connected, with its contract version', async ({ page }) => {
  await mockApi(page, MOCK_API_BASE_URL, {
    'GET /v1/health': { status: 200, json: healthResponse() },
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Plan a trip in your own words');
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText(
    `API connected · contract ${healthResponse().contractVersion}`,
  );
  await expectNoAxeViolations(page);
});

test('AC-WEB-12: shows the API as unavailable when health fails', async ({ page }) => {
  await mockApi(page, MOCK_API_BASE_URL, {
    'GET /v1/health': { status: 500, json: errorBody('INTERNAL_ERROR', 'boom') },
  });
  await page.goto('/');
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText('API unavailable');
  await expectNoAxeViolations(page);
});

test('AC-WEB-12: shows the API as unavailable when it cannot be reached', async ({ page }) => {
  await mockApi(page, MOCK_API_BASE_URL, { 'GET /v1/health': 'abort' });
  await page.goto('/');
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText('API unavailable');
  await expectNoAxeViolations(page);
});

test('AC-WEB-12: shows a checking state while health is pending', async ({ page }) => {
  await mockApi(page, MOCK_API_BASE_URL, { 'GET /v1/health': 'hang' });
  await page.goto('/');
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText('Checking the API…');
  await expectNoAxeViolations(page);
});
