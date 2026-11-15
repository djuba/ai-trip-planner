// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { InvitePrompt } from './invite-prompt';

const field = () => screen.getByRole('textbox', { name: 'Invite code' });
const submit = () => screen.getByRole('button', { name: 'Continue' });

it('AC-CONV-10: asks for a code, focuses the labelled field and submits it', () => {
  const onSubmit = vi.fn();
  render(<InvitePrompt state="asking" onSubmit={onSubmit} />);
  expect(screen.getByRole('heading', { name: 'Invite code' })).toBeVisible();
  expect(
    screen.getByText('This planner needs an invite code. Enter the one you were given.'),
  ).toBeVisible();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(field()).toHaveFocus();
  expect(field()).toHaveAttribute('autocomplete', 'off');
  expect(field()).toHaveAttribute('spellcheck', 'false');
  expect(field()).toHaveAttribute('autocapitalize', 'off');
  expect(field()).toHaveAttribute('type', 'text');
  fireEvent.change(field(), { target: { value: ' abc123 ' } });
  fireEvent.click(submit());
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith(' abc123 ');
});

it('AC-CONV-10: Continue is disabled while the field is blank', () => {
  const onSubmit = vi.fn();
  render(<InvitePrompt state="asking" onSubmit={onSubmit} />);
  expect(submit()).toBeDisabled();
  fireEvent.change(field(), { target: { value: '   ' } });
  expect(submit()).toBeDisabled();
  fireEvent.submit(field().closest('form') as HTMLFormElement);
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.change(field(), { target: { value: 'x' } });
  expect(submit()).toBeEnabled();
});

it('AC-CONV-10: a rejected code says so in an alert', () => {
  render(<InvitePrompt state="rejected" onSubmit={vi.fn()} />);
  expect(screen.getByRole('alert')).toHaveTextContent(
    "That code isn't valid. Check it and try again.",
  );
  expect(
    screen.queryByText('This planner needs an invite code. Enter the one you were given.'),
  ).toBeNull();
  expect(field()).toHaveFocus();
});
