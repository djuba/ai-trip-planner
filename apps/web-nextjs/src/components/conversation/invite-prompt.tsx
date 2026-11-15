// Invite code entry (AC-CONV-10). A plain text field, so the code can be checked by eye (plan D5),
// with autofill, spell-check and auto-capitalisation off.
'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function InvitePrompt({
  state,
  onSubmit,
}: {
  state: 'asking' | 'rejected';
  onSubmit: (code: string) => void;
}) {
  const [code, setCode] = useState('');
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (code.trim() === '') return;
    onSubmit(code);
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-3">
      <h2 id={`${id}-heading`} className="text-lg font-semibold">
        Invite code
      </h2>
      {state === 'rejected' ? (
        <p role="alert" className="text-sm text-destructive">
          That code isn&apos;t valid. Check it and try again.
        </p>
      ) : (
        <p className="text-sm">This planner needs an invite code. Enter the one you were given.</p>
      )}
      <form onSubmit={submit} className="flex flex-col gap-2">
        <label htmlFor={`${id}-code`} className="text-sm font-medium">
          Invite code
        </label>
        <Input
          id={`${id}-code`}
          ref={inputRef}
          type="text"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="off"
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
          }}
        />
        <Button type="submit" disabled={code.trim() === ''} className="self-start">
          Continue
        </Button>
      </form>
    </section>
  );
}
