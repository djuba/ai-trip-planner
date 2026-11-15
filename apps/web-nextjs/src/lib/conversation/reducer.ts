// The conversation's state machine (plan D1). Pure: no fetch, no React, no clock, no randomness,
// so every transition is a plain function test (CLAUDE.md §6.1, §6.3). The client owns the whole
// conversation and sends the current profile each turn, because the server is stateless (§5).
import type {
  ExtractRequest,
  ExtractResponse,
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
  /** Turn ids come from here, not from randomness (§6.1). */
  nextId: number;
}

export type Action =
  | { type: 'send'; request: ExtractRequest }
  | { type: 'succeeded'; response: ExtractResponse }
  | { type: 'failed'; error: ApiError; hadInviteCode: boolean }
  | { type: 'retry' }
  | { type: 'inviteSubmitted' }
  | { type: 'reset' };

export const initialState: ConversationState = {
  turns: [],
  profile: undefined,
  violations: [],
  status: 'idle',
  settled: 'idle',
  pending: undefined,
  error: undefined,
  invite: 'none',
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

function resend(state: ConversationState): ConversationState {
  if (state.pending === undefined || state.status === 'sending') return state;
  return { ...state, status: 'sending', error: undefined };
}

export function conversationReducer(state: ConversationState, action: Action): ConversationState {
  switch (action.type) {
    case 'send': {
      if (state.status === 'sending') return state;
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
    case 'inviteSubmitted':
      return resend({ ...state, invite: 'none' });
    case 'reset':
      return initialState;
  }
}

/** Whether the composer can send: not while a turn is in flight or a code is being asked for. */
export function canSend(state: ConversationState): boolean {
  return state.status !== 'sending' && state.invite === 'none';
}
