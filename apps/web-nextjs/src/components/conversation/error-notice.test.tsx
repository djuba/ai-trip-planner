// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ApiError } from '@/lib/api';
import { ErrorNotice } from './error-notice';

it('AC-CONV-09: a network error shows title and detail, and Retry calls onRetry', () => {
  const onRetry = vi.fn();
  render(<ErrorNotice error={{ kind: 'network' }} onRetry={onRetry} />);
  expect(screen.getByRole('alert')).toHaveTextContent("Can't reach the planner.");
  expect(screen.getByText('Check your connection and try again.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(onRetry).toHaveBeenCalledOnce();
});

it('AC-CONV-12: quota exhausted has no Retry', () => {
  render(<ErrorNotice error={{ kind: 'quota_exhausted' }} onRetry={vi.fn()} />);
  expect(screen.getByRole('alert')).toHaveTextContent('This invite has been used up.');
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
});

it('AC-CONV-12: rate limited with Retry-After says about how long, and offers Retry', () => {
  render(
    <ErrorNotice error={{ kind: 'rate_limited', retryAfterSeconds: 120 }} onRetry={vi.fn()} />,
  );
  expect(screen.getByText('Try again in about 2 minutes.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
});

it('AC-CONV-09: kinds handled elsewhere render nothing', () => {
  const kinds: ApiError[] = [{ kind: 'aborted' }, { kind: 'unauthorized' }];
  for (const error of kinds) {
    const { container, unmount } = render(<ErrorNotice error={error} onRetry={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    unmount();
  }
});
