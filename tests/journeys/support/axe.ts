// AC-JOURNEY-05: the same scan as the web functional suite, copied (this package imports nothing
// from other workspaces). It waits for animations to finish first, so axe never reads a colour
// halfway through a fade. No rule is disabled.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export async function expectNoAxeViolations(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== 'running'),
  );
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}
