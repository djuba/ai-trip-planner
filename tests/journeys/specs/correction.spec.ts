import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from '../support/axe.ts';
import { profilePanel, sendMessage, startTrip, thread } from '../support/start-trip.ts';

test('AC-JOURNEY-03: a correction replaces the earlier value @clarification @full', async ({
  page,
}) => {
  await startTrip(page, 'Two adults would like to go hiking.');
  await expect(thread(page).getByText('What needs fixing')).toBeVisible();
  const travelers = profilePanel(page)
    .locator('div')
    .filter({
      has: page.locator('dt', { hasText: 'Travelers' }),
    });
  await expect(travelers.locator('dd')).toHaveCount(2);

  await sendMessage(page, 'Actually, make it four adults.');
  await expect(travelers.locator('dd')).toHaveCount(4);
  await expect(travelers.locator('dd')).toHaveText(['Adult', 'Adult', 'Adult', 'Adult']);

  await expectNoAxeViolations(page);
});
