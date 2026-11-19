// The same scan as the web functional suite, copied (this package imports nothing from other
// workspaces). It waits for animations to finish first, so axe never reads a colour halfway
// through a fade. No rule is disabled. Every journey calls it, so the step names its AC.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

export async function expectNoAxeViolations(page: Page): Promise<void> {
  await test.step('AC-JOURNEY-05: the page has no axe violations', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() =>
      document.getAnimations().every((animation) => animation.playState !== 'running'),
    );
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}
