// The conversation's state machine (plan D1). Pure: no fetch, no React, no clock, no randomness,
// so every transition is a plain function test (CLAUDE.md §6.1, §6.3). The client owns the whole
// conversation and sends the current profile each turn, because the server is stateless (§5).
import type {
  ExtractRequest,
  ExtractResponse,
  PresentationModel,
  PresentRequest,
  RecommendRequest,
  RecommendResponse,
  RuleViolation,
  TripProfile,
} from '@vp/domain-schema/wire';
import type { ApiError } from '../api';

export type Turn =
  | { role: 'user'; id: string; text: string }
  | {
      role: 'assistant';
      id: string;
      kind: 'clarification';
      question: string;
      violations: RuleViolation[];
    }
  | { role: 'assistant'; id: string; kind: 'ready' };

/** `idle` = nothing answered yet; the other settled values come from the last response. */
export type SettledStatus = 'idle' | 'needs_clarification' | 'ready';
export type Status = SettledStatus | 'sending';

/** `asking`: a 401 with no stored code. `rejected`: a 401 although a code was sent. */
export type InviteState = 'none' | 'asking' | 'rejected';

/**
 * The step from a `ready` profile to recommendations (WU-14 plan D1, fix 3). Each in-flight or
 * failed step holds the request it sends, so Retry and an invite code resend exactly that step.
 */
export type TripState =
  | { step: 'none' }
  | { step: 'recommending'; request: RecommendRequest }
  | { step: 'presenting'; recommend: RecommendResponse; request: PresentRequest }
  | { step: 'presented'; recommend: RecommendResponse; model: PresentationModel }
  | { step: 'failed'; failedStep: 'recommend'; error: ApiError; request: RecommendRequest }
  | {
      step: 'failed';
      failedStep: 'present';
      error: ApiError;
      recommend: RecommendResponse;
      request: PresentRequest;
    };

export type TripStep = 'recommend' | 'present';

export interface ConversationState {
  turns: Turn[];
  /** Replaced wholesale by every response, never merged (WU-09 note). */
  profile: TripProfile | undefined;
  /** The last response's violations, for the profile panel. */
  violations: RuleViolation[];
  status: Status;
  /** The status before the turn in flight, restored when it fails (review fix 1). */
  settled: SettledStatus;
  /** The request in flight, or the one Retry sends again. Never lost on an error. */
  pending: ExtractRequest | undefined;
  error: ApiError | undefined;
  invite: InviteState;
  /** Recommendations for the current profile; cleared by every new extract response. */
  trip: TripState;
  /** Turn ids come from here, not from randomness (§6.1). */
  nextId: number;
}

export type Action =
  | { type: 'send'; request: ExtractRequest }
  | { type: 'succeeded'; response: ExtractResponse }
  | { type: 'failed'; error: ApiError; hadInviteCode: boolean }
  | { type: 'retry' }
  | { type: 'inviteSubmitted' }
  | { type: 'reset' }
  | { type: 'recommendRequested'; request: RecommendRequest }
  | { type: 'recommendSucceeded'; response: RecommendResponse }
  | { type: 'presentFinished'; model: PresentationModel }
  | { type: 'tripFailed'; step: TripStep; error: ApiError; hadInviteCode: boolean }
  | { type: 'tripRetry' };

export const initialState: ConversationState = {
  turns: [],
  profile: undefined,
  violations: [],
  status: 'idle',
  settled: 'idle',
  pending: undefined,
  error: undefined,
  invite: 'none',
  trip: { step: 'none' },
  nextId: 1,
};

function assistantTurn(response: ExtractResponse, id: string): Turn {
  return response.status === 'ready'
    ? { role: 'assistant', id, kind: 'ready' }
    : {
        role: 'assistant',
        id,
        kind: 'clarification',
        question: response.clarificationQuestion,
        violations: response.violations,
      };
}

/** Whether a trip step is in flight; no turn may start meanwhile (plan D1). */
export function tripInFlight(state: ConversationState): boolean {
  return state.trip.step === 'recommending' || state.trip.step === 'presenting';
}

function retryTrip(state: ConversationState): ConversationState {
  const { trip } = state;
  if (trip.step !== 'failed') return state;
  if (trip.failedStep === 'recommend') {
    return { ...state, trip: { step: 'recommending', request: trip.request } };
  }
  return {
    ...state,
    trip: { step: 'presenting', recommend: trip.recommend, request: trip.request },
  };
}

function failTrip(
  state: ConversationState,
  action: Extract<Action, { type: 'tripFailed' }>,
): ConversationState {
  const { trip } = state;
  const { error } = action;
  // Accepted only from the step that failed, so a late result is dropped (plan fix 5).
  const failed: TripState | undefined =
    action.step === 'recommend' && trip.step === 'recommending'
      ? { step: 'failed', failedStep: 'recommend', error, request: trip.request }
      : action.step === 'present' && trip.step === 'presenting'
        ? {
            step: 'failed',
            failedStep: 'present',
            error,
            recommend: trip.recommend,
            request: trip.request,
          }
        : undefined;
  if (failed === undefined) return state;
  // An abort the hook didn't start (the browser's): nothing to explain, so the step just ends.
  if (error.kind === 'aborted') return { ...state, trip: { step: 'none' } };
  if (error.kind === 'unauthorized') {
    return { ...state, trip: failed, invite: action.hadInviteCode ? 'rejected' : 'asking' };
  }
  return { ...state, trip: failed };
}

function resend(state: ConversationState): ConversationState {
  if (state.pending === undefined || state.status === 'sending') return state;
  return { ...state, status: 'sending', error: undefined };
}

export function conversationReducer(state: ConversationState, action: Action): ConversationState {
  switch (action.type) {
    case 'send': {
      if (state.status === 'sending' || tripInFlight(state)) return state;
      const turn: Turn = { role: 'user', id: `t${state.nextId}`, text: action.request.message };
      return {
        ...state,
        turns: [...state.turns, turn],
        status: 'sending',
        settled: state.status,
        pending: action.request,
        error: undefined,
        nextId: state.nextId + 1,
      };
    }
    case 'succeeded': {
      if (state.status !== 'sending') return state;
      const { response } = action;
      return {
        ...state,
        turns: [...state.turns, assistantTurn(response, `t${state.nextId}`)],
        profile: response.profile,
        violations: response.status === 'needs_clarification' ? response.violations : [],
        status: response.status,
        settled: response.status,
        pending: undefined,
        error: undefined,
        invite: 'none',
        // The results were for the old profile (AC-CARDS-11).
        trip: { step: 'none' },
        nextId: state.nextId + 1,
      };
    }
    case 'failed': {
      if (state.status !== 'sending') return state;
      const { error } = action;
      const settled = { ...state, status: state.settled };
      // The hook drops results of turns it aborted itself, so an abort here came from elsewhere
      // (the browser). There is nothing to explain; the composer just becomes usable again.
      if (error.kind === 'aborted') return settled;
      if (error.kind === 'unauthorized') {
        return {
          ...settled,
          error: undefined,
          invite: action.hadInviteCode ? 'rejected' : 'asking',
        };
      }
      return { ...settled, error };
    }
    case 'retry':
      return resend(state);
    case 'inviteSubmitted': {
      // Turns and trip steps never overlap, so a 401 came from exactly one of them (plan fix 3).
      const next: ConversationState = { ...state, invite: 'none' };
      if (state.pending !== undefined) return resend(next);
      return state.trip.step === 'failed' && state.trip.error.kind === 'unauthorized'
        ? retryTrip(next)
        : next;
    }
    case 'reset':
      return initialState;
    case 'recommendRequested':
      if (!canRecommend(state)) return state;
      return { ...state, trip: { step: 'recommending', request: action.request } };
    case 'recommendSucceeded': {
      if (state.trip.step !== 'recommending') return state;
      const { request } = state.trip;
      return {
        ...state,
        trip: {
          step: 'presenting',
          recommend: action.response,
          // Unchanged and in order (AC-CARDS-02).
          request: { profile: request.profile, recommendations: action.response.recommendations },
        },
      };
    }
    case 'presentFinished':
      if (state.trip.step !== 'presenting') return state;
      return {
        ...state,
        trip: { step: 'presented', recommend: state.trip.recommend, model: action.model },
      };
    case 'tripFailed':
      return failTrip(state, action);
    case 'tripRetry':
      return retryTrip(state);
  }
}

/** Whether the composer can send: not while a turn or trip step is in flight, or a code is asked for. */
export function canSend(state: ConversationState): boolean {
  return state.status !== 'sending' && state.invite === 'none' && !tripInFlight(state);
}

/** Whether "Get recommendations" is offered: a settled `ready` profile with no results yet. */
export function canRecommend(state: ConversationState): boolean {
  return (
    state.status === 'ready' &&
    state.profile !== undefined &&
    state.invite === 'none' &&
    state.trip.step === 'none'
  );
}
