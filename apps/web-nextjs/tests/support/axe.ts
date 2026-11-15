// The one axe scan every functional spec uses (CLAUDE.md §6.3: axe on every page state).
// It waits for CSS animations and transitions to finish first. Otherwise axe can read a colour
// halfway through a fade: the `verify` failure on `main` after WU-12 (WU-13 plan D12). The scan
// itself is never weakened: no rule is disabled, and it covers the whole page.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** Resolves once no animation or transition on the page is running. */
export async function waitForAnimationsToFinish(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== 'running'),
  );
}

export async function expectNoAxeViolations(page: Page): Promise<void> {
  // A backstop only: Tailwind's `transition-*` utilities ignore prefers-reduced-motion.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await waitForAnimationsToFinish(page);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}
