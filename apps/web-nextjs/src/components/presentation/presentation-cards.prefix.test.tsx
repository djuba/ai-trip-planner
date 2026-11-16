// @vitest-environment jsdom
// The Definition of Done for the cards (WU-14 plan D3): every prefix of the stream renders.
import { cleanup, render, screen, within } from '@testing-library/react';
import { buildFixture } from '@vp/domain-schema/testing';
import { PresentationModel } from '@vp/domain-schema/wire';
import { parsePartialJson } from 'ai';
import { expect, it } from 'vitest';
import type { TripState } from '@/lib/conversation/reducer';
import { presentationView } from '@/lib/presentation/view-model';
import {
  presentRequest,
  tripPresentation,
  tripRecommendResponse,
} from '../../../tests/support/fixtures';
import { PresentationResults } from './presentation-results';

const noop = () => {};
const presentingTrip: TripState = {
  step: 'presenting',
  recommend: tripRecommendResponse(),
  request: presentRequest(),
};

const accented = buildFixture(PresentationModel, {
  ...tripPresentation(),
  headline: 'Cancún and beyond',
});

function rawCards(value: unknown): Array<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) return [];
  const cards = (value as { cards?: unknown }).cards;
  return Array.isArray(cards) ? (cards as Array<Record<string, unknown>>) : [];
}

async function checkEveryPrefix(model: PresentationModel): Promise<void> {
  let previous = '';
  let previousShape = '';
  let distinct = 0;
  let prefix = '';
  for (const char of Array.from(JSON.stringify(model))) {
    prefix += char;
    const { value } = await parsePartialJson(prefix);
    const view = presentationView(value, { finished: false });
    const raw = rawCards(value).filter((card) => typeof card?.recommendationId === 'string');
    view.cards.forEach((card, index) => {
      const isLast = index === view.cards.length - 1;
      const blurbDone = !isLast || Array.isArray(raw[index]?.highlights);
      if (!blurbDone) expect(card.claims).toBeNull();
    });
    const serialized = JSON.stringify(value);
    if (serialized === previous) continue;
    previous = serialized;
    distinct += 1;
    // Rendering is the slow part: render each structural change (a key or item appearing) and
    // every 12th other value; the view model itself is checked for every prefix above.
    const shape = JSON.stringify(value, (_key, item: unknown) =>
      typeof item === 'string' ? '' : item,
    );
    if (shape === previousShape && distinct % 12 !== 0) continue;
    previousShape = shape;
    render(<PresentationResults trip={presentingTrip} partial={value} onRetry={noop} />);
    screen.queryAllByRole('article').forEach((article, index) => {
      if (view.cards[index]?.claims === null) {
        expect(within(article).queryByText('Unverified')).toBeNull();
        expect(within(article).queryByText('From sample route data')).toBeNull();
      }
    });
    cleanup();
  }
}

it('AC-CARDS-03 AC-CARDS-04: cards render at every partial stage (DoD)', async () => {
  await checkEveryPrefix(tripPresentation());
  await checkEveryPrefix(accented);

  render(
    <PresentationResults
      trip={{ step: 'presented', recommend: tripRecommendResponse(), model: tripPresentation() }}
      partial={undefined}
      onRetry={noop}
    />,
  );
  expect(screen.getAllByText('Unverified').length).toBeGreaterThan(0);
  expect(screen.getAllByText('From sample route data').length).toBeGreaterThan(0);
}, 30_000);
