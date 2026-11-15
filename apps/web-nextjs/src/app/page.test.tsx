// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import HomePage from './page';

vi.mock('@/components/api-status', () => ({
  ApiStatus: () => <div role="status">stub status</div>,
}));
vi.mock('@/components/conversation/conversation', () => ({
  Conversation: () => <div data-testid="conversation" />,
}));

it('AC-WEB-12: the shell renders its heading', () => {
  render(<HomePage />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Plan a trip');
});

it('AC-WEB-12: the footer holds the API status region', () => {
  render(<HomePage />);
  const footer = screen.getByRole('contentinfo');
  expect(footer).toContainElement(screen.getByRole('status'));
});

it('AC-CONV-01: the page holds the conversation in its main region', () => {
  render(<HomePage />);
  expect(screen.getByRole('main')).toContainElement(screen.getByTestId('conversation'));
});
