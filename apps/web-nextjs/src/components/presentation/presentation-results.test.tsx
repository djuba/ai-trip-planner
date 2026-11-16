// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { buildFixture } from '@vp/domain-schema/testing';
import { PresentationModel } from '@vp/domain-schema/wire';
import { expect, it, vi } from 'vitest';
import type { TripState } from '@/lib/conversation/reducer';
import {
  emptyPresentation,
  emptyRecommendResponse,
  presentRequest,
  recommendRequest,
  tripPresentation,
  tripRecommendResponse,
  tripRecommendWithConcernsResponse,
} from '../../../tests/support/fixtures';
import { PresentationResults } from './presentation-results';

const noop = () => {};
const presenting = (recommend = tripRecommendResponse()): TripState => ({
  step: 'presenting',
  recommend,
  request: presentRequest(),
});
const presented = (model = tripPresentation(), recommend = tripRecommendResponse()): TripState => ({
  step: 'presented',
  recommend,
  model,
});
const failed = (error: Extract<TripState, { step: 'failed' }>['error']): TripState => ({
  step: 'failed',
  failedStep: 'recommend',
  error,
  request: recommendRequest(),
});

it('AC-CARDS-05: a presented trip shows the headline, intro, cards and the ready status', () => {
  render(<PresentationResults trip={presented()} partial={undefined} onRetry={noop} />);
  expect(
    screen.getByRole('heading', { level: 2, name: 'Two calm Hawaiian beach weeks' }),
  ).toBeVisible();
  expect(
    screen.getByText('Both islands are warm in February and good for snorkeling.'),
  ).toBeVisible();
  expect(screen.getAllByRole('article')).toHaveLength(2);
  expect(screen.getByRole('status')).toHaveTextContent('Your recommendations are ready.');
  expect(screen.getAllByText('Unverified').length).toBeGreaterThan(0);
  expect(screen.getByText(/no live flight or hotel data/)).toBeVisible();
});

it('AC-CARDS-03: while presenting, only what the stream has produced is shown', () => {
  const partial = {
    headline: 'Two cal',
    cards: [{ recommendationId: 'rec-1', title: 'Maui', blurb: 'Calm tur' }],
  };
  render(<PresentationResults trip={presenting()} partial={partial} onRetry={noop} />);
  expect(screen.getByRole('heading', { level: 2, name: 'Two cal' })).toBeVisible();
  expect(screen.getByText('Calm tur')).toBeVisible();
  expect(screen.queryByText('Unverified')).toBeNull();
  expect(screen.queryByText(/no live flight/)).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('Writing up your trips…');
});

it('AC-CARDS-03: with no headline yet the section is still labelled', () => {
  render(<PresentationResults trip={presenting()} partial={{}} onRetry={noop} />);
  expect(screen.getByRole('region', { name: 'Recommendations' })).toBeVisible();
});

it('AC-CARDS-04: badges appear once the blurb is done', () => {
  const claims = [{ statement: 'Rentals cost $250.', verification: 'unverified' }];
  const partial = {
    cards: [{ recommendationId: 'rec-1', claims, title: 'Maui', blurb: 'x', highlights: ['a'] }],
  };
  render(<PresentationResults trip={presenting()} partial={partial} onRetry={noop} />);
  const card = screen.getByRole('article', { name: 'Maui' });
  expect(within(card).getByText('Rentals cost $250.')).toBeVisible();
  expect(within(card).getByText('Unverified')).toBeVisible();
});

it('AC-CARDS-07: a failed step shows an alert, and Retry calls onRetry', () => {
  const onRetry = vi.fn();
  render(
    <PresentationResults
      trip={failed({ kind: 'network' })}
      partial={{ cards: [] }}
      onRetry={onRetry}
    />,
  );
  expect(screen.getByRole('alert')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(onRetry).toHaveBeenCalledOnce();
  expect(screen.queryByRole('article')).toBeNull();
});

it('AC-CARDS-07: an unauthorized failure shows no alert', () => {
  render(
    <PresentationResults
      trip={failed({ kind: 'unauthorized' })}
      partial={undefined}
      onRetry={noop}
    />,
  );
  expect(screen.queryByRole('alert')).toBeNull();
});

it('AC-CARDS-08: unresolved critique concerns add a note', () => {
  const { rerender } = render(
    <PresentationResults
      trip={presented(tripPresentation(), tripRecommendWithConcernsResponse())}
      partial={undefined}
      onRetry={noop}
    />,
  );
  expect(screen.getByText(/still had concerns about these suggestions/)).toBeVisible();
  rerender(<PresentationResults trip={presented()} partial={undefined} onRetry={noop} />);
  expect(screen.queryByText(/still had concerns/)).toBeNull();
});

it('AC-CARDS-09: zero results say so and show no list', () => {
  render(
    <PresentationResults
      trip={presented(emptyPresentation(), emptyRecommendResponse())}
      partial={undefined}
      onRetry={noop}
    />,
  );
  expect(screen.getByText('No trips matched this profile. Try changing a detail.')).toBeVisible();
  expect(screen.queryByRole('list')).toBeNull();
  expect(screen.queryByText(/no live flight/)).toBeNull();
});

it('AC-CARDS-10: the status element exists in every step, with its text', () => {
  const steps: Array<[TripState, string]> = [
    [{ step: 'none' }, ''],
    [{ step: 'recommending', request: recommendRequest() }, 'Finding trips…'],
    [presenting(), 'Writing up your trips…'],
    [presented(), 'Your recommendations are ready.'],
    [failed({ kind: 'network' }), ''],
  ];
  for (const [trip, text] of steps) {
    const { unmount } = render(
      <PresentationResults trip={trip} partial={undefined} onRetry={noop} />,
    );
    expect(screen.getByRole('status', { hidden: true })).toHaveTextContent(text);
    unmount();
  }
});

it('AC-CARDS-10: the list is busy only while presenting', () => {
  const partial = { cards: [{ recommendationId: 'rec-1' }] };
  const { rerender } = render(
    <PresentationResults trip={presenting()} partial={partial} onRetry={noop} />,
  );
  expect(screen.getByRole('list')).toHaveAttribute('aria-busy', 'true');
  rerender(<PresentationResults trip={presented()} partial={undefined} onRetry={noop} />);
  expect(screen.getAllByRole('list')[0]).toHaveAttribute('aria-busy', 'false');
});

it('AC-CARDS-03: steps other than presenting ignore a non-empty partial', () => {
  const partial = { headline: 'Stale', cards: [{ recommendationId: 'rec-1', title: 'Stale' }] };
  const trips: TripState[] = [
    { step: 'none' },
    { step: 'recommending', request: recommendRequest() },
    failed({ kind: 'network' }),
  ];
  for (const trip of trips) {
    const { unmount } = render(
      <PresentationResults trip={trip} partial={partial} onRetry={noop} />,
    );
    expect(screen.queryByText('Stale')).toBeNull();
    expect(screen.queryByRole('article')).toBeNull();
    unmount();
  }
});

it('AC-CARDS-12: markup in the model text renders literally', () => {
  const model = buildFixture(PresentationModel, {
    headline: '<b>head</b>',
    intro: '<i>intro</i>',
    cards: [
      {
        recommendationId: 'rec-1',
        claims: [{ kind: 'price', statement: '<s>claim</s>', verification: 'unverified' }],
        title: '<u>title</u>',
        blurb: '<b>blurb</b>',
        highlights: ['<em>hi</em>'],
      },
    ],
  });
  render(<PresentationResults trip={presented(model)} partial={undefined} onRetry={noop} />);
  for (const text of [
    '<b>head</b>',
    '<i>intro</i>',
    '<u>title</u>',
    '<b>blurb</b>',
    '<em>hi</em>',
    '<s>claim</s>',
  ]) {
    expect(screen.getByText(text)).toBeVisible();
  }
});
