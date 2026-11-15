// A self-test of the shared axe helper (WU-13 plan D12, review fix 6). The flake it fixes showed up
// only on CI, so green runs alone can't prove the fix. This test slows the status badge's colour
// transition down to seconds, checks that the transition really is running when the badge changes,
// and then checks that the helper's scan passes only after the transition has finished.
import { expect, test } from '@playwright/test';
import { MOCK_API_BASE_URL } from '../../playwright.config.ts';
import { expectNoAxeViolations } from '../support/axe.ts';
import { mockApi } from '../support/mock-api.ts';

const SLOW_TRANSITION_MS = 3000;

const runningBadgeTransitions = () =>
  document
    .getAnimations()
    .filter(
      (animation) =>
        animation.playState === 'running' &&
        animation.effect instanceof KeyframeEffect &&
        animation.effect.target instanceof Element &&
        animation.effect.target.matches('[data-slot="badge"]'),
    ).length;

test('the axe helper waits for a running colour transition before it scans', async ({ page }) => {
  await page.addInitScript((ms) => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = `[data-slot="badge"] { transition-duration: ${ms}ms !important; transition-timing-function: linear !important; }`;
      document.head.append(style);
    });
  }, SLOW_TRANSITION_MS);
  await mockApi(page, MOCK_API_BASE_URL, { 'GET /v1/health': 'abort' });
  await page.goto('/');

  const badge = page.getByRole('contentinfo').getByRole('status');
  await expect(badge).toHaveText('API unavailable');
  // The precondition the CI flake needed: the badge is still fading to its final colour.
  expect(await page.evaluate(runningBadgeTransitions)).toBeGreaterThan(0);

  await expectNoAxeViolations(page);
  expect(await page.evaluate(runningBadgeTransitions)).toBe(0);
});
