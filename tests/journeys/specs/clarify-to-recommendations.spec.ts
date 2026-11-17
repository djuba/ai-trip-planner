import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from '../support/axe.ts';
import { sendMessage, startTrip, thread } from '../support/start-trip.ts';

test('AC-JOURNEY-01: vague request → clarification → recommendations @clarification @smoke', async ({
  page,
}) => {
  await startTrip(page, "I'd like a beach holiday sometime.");
  await expect(thread(page).getByText('What needs fixing')).toBeVisible();

  await sendMessage(
    page,
    'Two adults flying from Chicago, somewhere in the Caribbean in March 2027.',
  );
  await expect(thread(page).getByText(/Your trip profile is ready/)).toBeVisible();

  await page.getByRole('button', { name: 'Get recommendations' }).click();
  // The results area has its own status line; the thread has another, so scope by text.
  await expect(
    page.getByRole('status').filter({ hasText: 'Your recommendations are ready.' }),
  ).toBeVisible({
    timeout: 60_000,
  });
  const cards = page.getByRole('heading', { level: 3 });
  await expect(cards.first()).toBeVisible();

  await expectNoAxeViolations(page);
});
