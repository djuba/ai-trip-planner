'use client';
// Runs the conversation's turns (plan D1): the only place that calls the API. The reducer decides
// what each result means; this hook builds requests, sends them and aborts superseded ones.
import type { ExtractRequest } from '@vp/domain-schema/wire';
import { useCallback, useEffect, useReducer } from 'react';
import type { ApiClient } from '../api';
import type { InviteStore } from '../invite';
import { conversationReducer, initialState, type ConversationState } from './reducer';

/**
 * `client` and `invites` must keep their identity across renders (memoize them): the sending
 * effect depends on them, so a new object would abort the turn in flight and send it again.
 * `Conversation` holds both stable.
 */
export interface ConversationDeps {
  client: Pick<ApiClient, 'extract'>;
  invites: InviteStore;
  /** Today's local date, `YYYY-MM-DD` (plan D2). Injected so tests control it. */
  today: () => string;
}

export interface Conversation {
  state: ConversationState;
  send: (text: string) => void;
  retry: () => void;
  submitInvite: (code: string) => void;
  reset: () => void;
}

export function useConversation({ client, invites, today }: ConversationDeps): Conversation {
  const [state, dispatch] = useReducer(conversationReducer, initialState);
  const { status, pending } = state;

  // Sending is driven by state: `send`, `retry` and `inviteSubmitted` put the reducer into
  // `sending` with a pending request, and this effect sends it. Leaving `sending` (a result, or
  // Start over) or unmounting aborts the request, and an aborted request's result is dropped.
  useEffect(() => {
    if (status !== 'sending' || pending === undefined) return;
    const controller = new AbortController();
    const hadInviteCode = Boolean(invites.get()?.trim());
    void client.extract(pending, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      dispatch(
        result.ok
          ? { type: 'succeeded', response: result.data }
          : { type: 'failed', error: result.error, hadInviteCode },
      );
    });
    return () => controller.abort();
  }, [status, pending, client, invites]);

  const send = useCallback(
    (text: string) => {
      const request: ExtractRequest = {
        message: text,
        ...(state.profile === undefined ? {} : { currentProfile: state.profile }),
        referenceDate: today(),
      };
      dispatch({ type: 'send', request });
    },
    [state.profile, today],
  );

  const retry = useCallback(() => dispatch({ type: 'retry' }), []);

  const submitInvite = useCallback(
    (code: string) => {
      invites.set(code.trim());
      dispatch({ type: 'inviteSubmitted' });
    },
    [invites],
  );

  const reset = useCallback(() => dispatch({ type: 'reset' }), []);

  return { state, send, retry, submitInvite, reset };
}
