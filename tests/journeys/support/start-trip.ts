import { expect, type Locator, type Page } from '@playwright/test';
import { fixClock } from './clock.ts';

export function inviteCode(): string {
  const code = process.env.JOURNEY_INVITE_CODE;
  if (code === undefined || code === '') {
    throw new Error('JOURNEY_INVITE_CODE is not set. Run the journeys with `pnpm test:journeys`.');
  }
  return code;
}

export function thread(page: Page): Locator {
  return page.getByRole('region', { name: 'Conversation' });
}

export function profilePanel(page: Page): Locator {
  return page.getByRole('region', { name: 'Your trip so far' });
}

/** Types a message into the composer and sends it. */
export async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByLabel('Your message').fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
}

/**
 * Opens the app with the clock fixed, sends the first message, gets the 401 the API gives
 * without a code, enters the invite code as a user would; the UI then retries the turn.
 */
export async function startTrip(page: Page, firstMessage: string): Promise<void> {
  const code = inviteCode();
  await fixClock(page);
  await page.goto('/');
  await sendMessage(page, firstMessage);
  await page.getByRole('textbox', { name: 'Invite code' }).fill(code);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('textbox', { name: 'Invite code' })).toBeHidden();
}
