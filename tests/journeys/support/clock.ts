import type { Page } from '@playwright/test';

/** The fixed "now" of every journey, so the requests' referenceDate (and cassette keys) never change. */
export const JOURNEY_NOW = new Date('2026-11-16T12:00:00Z');

export async function fixClock(page: Page): Promise<void> {
  await page.clock.setFixedTime(JOURNEY_NOW);
}
