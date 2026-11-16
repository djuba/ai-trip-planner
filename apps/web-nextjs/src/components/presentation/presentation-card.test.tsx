// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { CardView } from '@/lib/presentation/view-model';
import { PresentationCard } from './presentation-card';

const full: CardView = {
  key: 'rec-1',
  title: 'Maui',
  blurb: 'Calm bays.',
  highlights: ['Snorkel', 'Sunset'],
  claims: [
    { statement: 'Rentals cost $250.', verification: 'unverified' },
    { statement: 'Non-stop from LAX.', verification: 'fixture' },
  ],
};

it('AC-CARDS-05: a full card shows title, blurb, highlights and claims with badges', () => {
  render(<PresentationCard card={full} />);
  const article = screen.getByRole('article', { name: 'Maui' });
  expect(within(article).getByRole('heading', { level: 3, name: 'Maui' })).toBeVisible();
  expect(within(article).getByText('Calm bays.')).toBeVisible();
  expect(within(article).getAllByRole('listitem')).toHaveLength(4);
  const claims = within(article).getByRole('list', { name: 'Claims' });
  expect(claims).toHaveTextContent('Rentals cost $250.Unverified');
  expect(claims).toHaveTextContent('Non-stop from LAX.From sample route data');
});

it('AC-CARDS-03: missing keys render nothing, and the card still has a label', () => {
  render(<PresentationCard card={{ key: 'rec-1', highlights: [], claims: null }} />);
  expect(screen.getByRole('article', { name: 'Recommendation' })).toBeVisible();
  expect(screen.queryByRole('heading')).toBeNull();
  expect(screen.queryByRole('list')).toBeNull();
});

it('AC-CARDS-03: a cut-short blurb renders as received', () => {
  render(<PresentationCard card={{ key: 'a', blurb: 'Calm tur', highlights: [], claims: null }} />);
  expect(screen.getByText('Calm tur')).toBeVisible();
});

it('AC-CARDS-04: held-back claims show no badges, and an empty claim list shows no list', () => {
  const { rerender } = render(<PresentationCard card={{ ...full, claims: null }} />);
  expect(screen.queryByText('Unverified')).toBeNull();
  rerender(<PresentationCard card={{ ...full, claims: [] }} />);
  expect(screen.queryByRole('list', { name: 'Claims' })).toBeNull();
});

it('AC-CARDS-12: markup in model text renders literally', () => {
  render(
    <PresentationCard
      card={{
        key: 'a',
        title: '<b>t</b>',
        blurb: '<i>b</i>',
        highlights: ['<u>h</u>'],
        claims: [{ statement: '<s>c</s>', verification: 'unverified' }],
      }}
    />,
  );
  for (const text of ['<b>t</b>', '<i>b</i>', '<u>h</u>', '<s>c</s>']) {
    expect(screen.getByText(text)).toBeVisible();
  }
});
