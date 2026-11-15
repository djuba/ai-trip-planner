// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { Turn } from '@/lib/conversation/reducer';
import { describeViolation } from '@/lib/messages';
import { MessageThread } from './message-thread';

const violation = {
  code: 'CHILD_AGE_RANGE',
  path: '/people/0/age',
  params: { age: 18, min: 0, max: 17 },
} as const;

it('AC-CONV-01: shows the intro when empty and the user text as typed', () => {
  const { rerender } = render(<MessageThread turns={[]} sending={false} />);
  expect(screen.getByText('Describe where you want to go, when, and who is coming.')).toBeVisible();
  const turns: Turn[] = [{ role: 'user', id: 't1', text: 'Beach trip\nfor four' }];
  rerender(<MessageThread turns={turns} sending={false} />);
  expect(screen.getByText('You')).toBeVisible();
  expect(screen.getByText(/Beach trip/)).toHaveTextContent('Beach trip for four');
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  expect(screen.getByRole('heading', { name: 'Conversation' })).toBeInTheDocument();
});

it('AC-CONV-02: renders the question literally and lists violations from the catalog', () => {
  const turns: Turn[] = [
    {
      role: 'assistant',
      id: 't2',
      kind: 'clarification',
      question: 'Is that <b>hi</b> right?',
      violations: [violation],
    },
  ];
  const { container } = render(<MessageThread turns={turns} sending={false} />);
  expect(screen.getByText('Is that <b>hi</b> right?')).toBeVisible();
  expect(container.querySelector('b')).toBeNull();
  expect(screen.getByText('What needs fixing')).toBeVisible();
  expect(screen.getByText(describeViolation(violation))).toBeVisible();
});

it('AC-CONV-04: shows that the profile is ready', () => {
  const turns: Turn[] = [{ role: 'assistant', id: 't3', kind: 'ready' }];
  render(<MessageThread turns={turns} sending={false} />);
  const item = screen.getByRole('listitem');
  expect(within(item).getByText('Planner')).toBeVisible();
  expect(
    within(item).getByText(/Your trip profile is ready\. You can still correct anything/),
  ).toBeVisible();
});

it('AC-CONV-08: shows Planning… only while sending, in a status region that is always there', () => {
  const { rerender } = render(<MessageThread turns={[]} sending={false} />);
  const status = screen.getByRole('status');
  expect(status).toBeEmptyDOMElement();
  rerender(<MessageThread turns={[]} sending />);
  expect(screen.getByRole('status')).toBe(status);
  expect(status).toHaveTextContent('Planning…');
});
