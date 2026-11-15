// @vitest-environment jsdom
import { MAX_MESSAGE_LENGTH } from '@vp/domain-schema/wire';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MessageComposer } from './message-composer';

const field = () => screen.getByRole('textbox', { name: 'Your message' });
const send = () => screen.getByRole('button', { name: 'Send' });
const type = (value: string) => {
  fireEvent.change(field(), { target: { value } });
};

it('AC-CONV-01: submitting calls onSend with the text as typed and clears the field', () => {
  const onSend = vi.fn();
  render(<MessageComposer onSend={onSend} disabled={false} />);
  type('  Beach in May  ');
  fireEvent.click(send());
  expect(onSend).toHaveBeenCalledExactlyOnceWith('  Beach in May  ');
  expect(field()).toHaveValue('');
});

it('AC-CONV-07: counts an emoji as one character and has no maxlength', () => {
  render(<MessageComposer onSend={vi.fn()} disabled={false} />);
  expect(screen.getByText(`${MAX_MESSAGE_LENGTH} characters left`)).toBeVisible();
  type('😀');
  expect(screen.getByText(`${MAX_MESSAGE_LENGTH - 1} characters left`)).toBeVisible();
  expect(field()).not.toHaveAttribute('maxlength');
  expect(field()).toHaveAccessibleDescription(`${MAX_MESSAGE_LENGTH - 1} characters left`);
});

it('AC-CONV-07: says 1 character left in the singular', () => {
  render(<MessageComposer onSend={vi.fn()} disabled={false} />);
  type('😀'.repeat(MAX_MESSAGE_LENGTH - 1));
  expect(screen.getByText('1 character left')).toBeVisible();
});

it('AC-CONV-07: exactly MAX_MESSAGE_LENGTH emoji can be sent', () => {
  const onSend = vi.fn();
  render(<MessageComposer onSend={onSend} disabled={false} />);
  const full = '😀'.repeat(MAX_MESSAGE_LENGTH);
  type(full);
  expect(send()).toBeEnabled();
  expect(field()).not.toHaveAttribute('aria-invalid');
  fireEvent.click(send());
  expect(onSend).toHaveBeenCalledExactlyOnceWith(full);
});

it('AC-CONV-07: one over the limit disables Send and says why', () => {
  const onSend = vi.fn();
  render(<MessageComposer onSend={onSend} disabled={false} />);
  type('😀'.repeat(MAX_MESSAGE_LENGTH + 1));
  expect(send()).toBeDisabled();
  expect(field()).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText("That's 1 character over the limit.")).toBeVisible();
  expect(screen.getByText('0 characters left')).toBeVisible();
  expect(field()).toHaveAccessibleDescription(/over the limit/);
  fireEvent.submit(field().closest('form') as HTMLFormElement);
  expect(onSend).not.toHaveBeenCalled();
  type('😀'.repeat(MAX_MESSAGE_LENGTH + 2));
  expect(screen.getByText("That's 2 characters over the limit.")).toBeVisible();
});

it('AC-CONV-07: a blank message cannot be sent', () => {
  const onSend = vi.fn();
  render(<MessageComposer onSend={onSend} disabled={false} />);
  expect(send()).toBeDisabled();
  type('  \n ');
  expect(send()).toBeDisabled();
  fireEvent.submit(field().closest('form') as HTMLFormElement);
  expect(onSend).not.toHaveBeenCalled();
});

it('AC-CONV-08: the disabled prop disables Send', () => {
  const onSend = vi.fn();
  render(<MessageComposer onSend={onSend} disabled />);
  type('Hello');
  expect(send()).toBeDisabled();
  fireEvent.submit(field().closest('form') as HTMLFormElement);
  expect(onSend).not.toHaveBeenCalled();
});
