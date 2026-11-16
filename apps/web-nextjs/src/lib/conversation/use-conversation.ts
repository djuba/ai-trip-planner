'use client';
// Runs the conversation's turns and trip steps (WU-13 plan D1, WU-14 plan D1): the only place that
// calls the API. The reducer decides what each result means; this hook builds requests, sends
// them and aborts superseded ones. `/present` streams through `usePresentation`.
import type { ExtractRequest, PresentationModel } from '@vp/domain-schema/wire';
import { useCallback, useEffect, useReducer } from 'react';
import type { ApiClient, ApiError } from '../api';
import type { InviteStore } from '../invite';
import { usePresentation } from '../presentation/use-presentation';
import { conversationReducer, initialState, type ConversationState } from './reducer';

/**
 * `client` and `invites` must keep their identity across renders (memoize them): the sending
 * effects depend on them, so a new object would abort the request in flight and send it again.
 * `Conversation` holds both stable.
 */
export interface ConversationDeps {
  client: Pick<ApiClient, 'extract' | 'recommend' | 'present'>;
  invites: InviteStore;
  /** Today's local date, `YYYY-MM-DD` (WU-13 plan D2). Injected so tests control it. */
  today: () => string;
}

export interface Conversation {
  state: ConversationState;
  /** The `/present` partial object; meaningful only while `state.trip.step === 'presenting'`. */
  partial: unknown;
  send: (text: string) => void;
  retry: () => void;
  submitInvite: (code: string) => void;
  reset: () => void;
  getRecommendations: () => void;
  retryTrip: () => void;
}

export function useConversation({ client, invites, today }: ConversationDeps): Conversation {
  const [state, dispatch] = useReducer(conversationReducer, initialState);
  const { status, pending, trip } = state;

  const hasInviteCode = useCallback(() => Boolean(invites.get()?.trim()), [invites]);

  // Sending is driven by state: `send`, `retry` and `inviteSubmitted` put the reducer into
  // `sending` with a pending request, and this effect sends it. Leaving `sending` (a result, or
  // Start over) or unmounting aborts the request, and an aborted request's result is dropped.
  useEffect(() => {
    if (status !== 'sending' || pending === undefined) return;
    const controller = new AbortController();
    const hadInviteCode = hasInviteCode();
    void client.extract(pending, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      dispatch(
        result.ok
          ? { type: 'succeeded', response: result.data }
          : { type: 'failed', error: result.error, hadInviteCode },
      );
    });
    return () => controller.abort();
  }, [status, pending, client, hasInviteCode]);

  // `/recommend` runs the same way while the trip is `recommending`.
  const recommendRequest = trip.step === 'recommending' ? trip.request : undefined;
  useEffect(() => {
    if (recommendRequest === undefined) return;
    const controller = new AbortController();
    const hadInviteCode = hasInviteCode();
    void client.recommend(recommendRequest, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      dispatch(
        result.ok
          ? { type: 'recommendSucceeded', response: result.data }
          : { type: 'tripFailed', step: 'recommend', error: result.error, hadInviteCode },
      );
    });
    return () => controller.abort();
  }, [recommendRequest, client, hasInviteCode]);

  const onFinished = useCallback(
    (model: PresentationModel) => dispatch({ type: 'presentFinished', model }),
    [],
  );
  const onFailed = useCallback(
    (error: ApiError, hadInviteCode: boolean) =>
      dispatch({ type: 'tripFailed', step: 'present', error, hadInviteCode }),
    [],
  );
  const presentation = usePresentation({ client, hasInviteCode, onFinished, onFailed });
  const { submit: submitPresent, clear: clearPresent } = presentation;

  // `/present` streams while the trip is `presenting`. Leaving that step for any reason (done,
  // failed, Start over, a new profile) clears the partial object, so the view can never show a
  // stale or unvalidated card (plan fix 2). Retry enters the step again with the same request.
  const presentRequest = trip.step === 'presenting' ? trip.request : undefined;
  useEffect(() => {
    if (presentRequest === undefined) return;
    submitPresent(presentRequest);
    return () => clearPresent();
  }, [presentRequest, submitPresent, clearPresent]);

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

  const getRecommendations = useCallback(() => {
    if (state.profile === undefined) return;
    dispatch({
      type: 'recommendRequested',
      request: { profile: state.profile, referenceDate: today() },
    });
  }, [state.profile, today]);

  const retryTrip = useCallback(() => dispatch({ type: 'tripRetry' }), []);

  return {
    state,
    partial: presentation.partial,
    send,
    retry,
    submitInvite,
    reset,
    getRecommendations,
    retryTrip,
  };
}
