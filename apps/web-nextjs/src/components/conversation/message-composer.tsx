// The message box (AC-CONV-01, -07, -08). Length is counted in code points and never limited
// with a `maxlength` attribute, so an over-long paste is explained rather than silently cut.
'use client';

import { codePointLength, MAX_MESSAGE_LENGTH } from '@vp/domain-schema/wire';
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

function characters(count: number): string {
  return count === 1 ? '1 character' : `${count} characters`;
}

export function MessageComposer({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState('');
  const id = useId();
  const counterId = `${id}-counter`;
  const overId = `${id}-over`;
  const left = MAX_MESSAGE_LENGTH - codePointLength(text);
  const over = left < 0;
  const blank = text.trim() === '';

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || blank || over) return;
    onSend(text);
    setText('');
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor={`${id}-message`} className="text-sm font-medium">
        Your message
      </label>
      <Textarea
        id={`${id}-message`}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        aria-invalid={over ? true : undefined}
        aria-describedby={over ? `${counterId} ${overId}` : counterId}
      />
      <p id={counterId} className="text-xs text-muted-foreground">
        {`${characters(Math.max(left, 0))} left`}
      </p>
      {/* Always in the DOM, so screen readers announce the text when it appears (review fix 1). */}
      <p id={overId} aria-live="polite" className="text-sm text-destructive empty:hidden">
        {over ? `That's ${characters(-left)} over the limit.` : ''}
      </p>
      <Button type="submit" disabled={disabled || blank || over} className="self-start">
        Send
      </Button>
    </form>
  );
}
