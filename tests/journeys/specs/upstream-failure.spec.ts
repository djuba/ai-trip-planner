import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from '../support/axe.ts';
import { startTrip, thread } from '../support/start-trip.ts';

// The same text is UPSTREAM_FAILURE_MESSAGE in scripts/journeys/plan-stack.ts; the two must match.
const UPSTREAM_FAILURE_MESSAGE = 'A quiet cabin somewhere in the mountains for our anniversary.';

test('AC-JOURNEY-04: upstream failure → recoverable error @clarification @full', async ({
  page,
}) => {
  test.fail(
    process.env.JOURNEYS_RECORDING === '1',
    'recording: the call succeeds, so the 502 path cannot happen',
  );
  await startTrip(page, UPSTREAM_FAILURE_MESSAGE);

  const alert = page
    .getByRole('alert')
    .filter({ has: page.getByRole('button', { name: 'Retry' }) });
  await expect(alert).toBeVisible();
  await expect(thread(page).getByText(UPSTREAM_FAILURE_MESSAGE)).toBeVisible();

  const composer = page.getByLabel('Your message');
  await composer.fill('Maybe a lake instead.');
  await expect(composer).toHaveValue('Maybe a lake instead.');

  await expectNoAxeViolations(page);
});
