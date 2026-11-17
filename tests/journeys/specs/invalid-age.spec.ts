import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from '../support/axe.ts';
import { profilePanel, startTrip, thread } from '../support/start-trip.ts';

test('AC-JOURNEY-02: invalid traveler age → targeted clarification @clarification @critical', async ({
  page,
}) => {
  await startTrip(page, 'A trip for me and my 19-year-old child.');

  // The CHILD_AGE_RANGE catalog text: "A child's age must be from {min} to {max}, ...". Each turn
  // is a list item too, so match the item that holds no nested list: the "What needs fixing" entry.
  await expect(
    thread(page)
      .getByRole('listitem')
      .filter({ hasText: /child's age/i, hasNot: page.getByRole('list') }),
  ).toBeVisible();
  const travelers = profilePanel(page)
    .locator('div')
    .filter({
      has: page.locator('dt', { hasText: 'Travelers' }),
    });
  await expect(travelers.getByText('Needs attention')).toBeVisible();

  await expectNoAxeViolations(page);
});
