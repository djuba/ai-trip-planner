// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { ProfileRow } from '@/lib/conversation/profile-summary';
import { ProfilePanel } from './profile-panel';

it('AC-CONV-06: says there is nothing yet when there are no rows', () => {
  render(<ProfilePanel rows={[]} />);
  expect(screen.getByRole('heading', { name: 'Your trip so far' })).toBeVisible();
  expect(screen.getByText('Nothing yet. Describe your trip to get started.')).toBeVisible();
  expect(screen.queryByText('From')).toBeNull();
});

it('AC-CONV-06: shows labels and values, with the badge only on flagged rows', () => {
  const rows: ProfileRow[] = [
    { field: 'region', label: 'Where', values: ['Portugal'], needsAttention: false },
    {
      field: 'people',
      label: 'Travelers',
      values: ['Adult, 40', 'Child, 18'],
      needsAttention: true,
    },
  ];
  render(<ProfilePanel rows={rows} />);
  expect(screen.queryByText('Nothing yet. Describe your trip to get started.')).toBeNull();
  expect(screen.getByText('Where')).toBeVisible();
  expect(screen.getByText('Portugal')).toBeVisible();
  expect(screen.getByText('Adult, 40')).toBeVisible();
  expect(screen.getByText('Child, 18')).toBeVisible();
  const badges = screen.getAllByText('Needs attention');
  expect(badges).toHaveLength(1);
  const flagged = screen.getByText('Travelers').closest('dt');
  expect(flagged).not.toBeNull();
  expect(within(flagged as HTMLElement).getByText('Needs attention')).toBeVisible();
});
