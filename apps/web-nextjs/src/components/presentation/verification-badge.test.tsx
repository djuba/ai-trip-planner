// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { VerificationBadge } from './verification-badge';

it('AC-CARDS-04: unverified is labelled Unverified', () => {
  render(<VerificationBadge verification="unverified" />);
  expect(screen.getByText('Unverified')).toBeVisible();
});

it('AC-CARDS-04: fixture is labelled From sample route data', () => {
  render(<VerificationBadge verification="fixture" />);
  expect(screen.getByText('From sample route data')).toBeVisible();
});
