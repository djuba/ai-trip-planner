import { buildFixture } from '@vp/domain-schema/testing';
import { ExtractRequest, ExtractResponse } from '@vp/domain-schema/wire';
import { describe, expect, it } from 'vitest';
import type { ApiError } from '../api';
import {
  canSend,
  conversationReducer as reduce,
  initialState,
  type Action,
  type ConversationState,
} from './reducer';

const first = buildFixture(ExtractRequest, {
  message: 'Somewhere warm',
  referenceDate: '2030-01-15',
});
const clarificationResponse = buildFixture(ExtractResponse, {
  status: 'needs_clarification',
  profile: { climate: 'warm', region: 'Caribbean' },
  violations: [{ code: 'INSUFFICIENT_DETAIL', path: '', params: { populated: 2, required: 3 } }],
  clarificationQuestion: 'When would you like to go, and who is coming?',
});
if (clarificationResponse.status !== 'needs_clarification') throw new Error('fixture status');
const clarification = clarificationResponse;
const second = buildFixture(ExtractRequest, {
  message: 'In March, two adults',
  currentProfile: clarification.profile,
  referenceDate: '2030-01-15',
});
const ready = buildFixture(ExtractResponse, {
  status: 'ready',
  profile: {
    climate: 'warm',
    dateRange: { kind: 'flexible', month: 3, year: 2030 },
    people: [{ userType: 'adult' }, { userType: 'adult' }],
  },
});

const run = (actions: Action[], from: ConversationState = initialState) =>
  actions.reduce(reduce, from);

const fail = (error: ApiError, hadInviteCode = false): Action => ({
  type: 'failed',
  error,
  hadInviteCode,
});

const afterClarification = run([
  { type: 'send', request: first },
  { type: 'succeeded', response: clarification },
]);

describe('sending', () => {
  it('AC-CONV-01: the first send adds the user turn and holds the request as pending', () => {
    const s = reduce(initialState, { type: 'send', request: first });
    expect(s.turns).toEqual([{ role: 'user', id: 't1', text: 'Somewhere warm' }]);
    expect(s.status).toBe('sending');
    expect(s.settled).toBe('idle');
    expect(s.pending).toBe(first);
  });

  it('AC-CONV-08: a second send while one is in flight is ignored', () => {
    const sending = reduce(initialState, { type: 'send', request: first });
    expect(reduce(sending, { type: 'send', request: second })).toBe(sending);
    expect(canSend(sending)).toBe(false);
  });

  it('AC-CONV-08: the composer can send when idle', () => {
    expect(canSend(initialState)).toBe(true);
  });
});

describe('responses', () => {
  it('AC-CONV-02: needs_clarification adds the question with its violations', () => {
    expect(afterClarification.turns[1]).toEqual({
      role: 'assistant',
      id: 't2',
      kind: 'clarification',
      question: clarification.clarificationQuestion,
      violations: clarification.violations,
    });
    expect(afterClarification.status).toBe('needs_clarification');
    expect(afterClarification.violations).toEqual(clarification.violations);
    expect(afterClarification.pending).toBeUndefined();
  });

  it('AC-CONV-03: the response profile replaces the old one; a dropped field disappears', () => {
    const s = run(
      [
        { type: 'send', request: second },
        { type: 'succeeded', response: ready },
      ],
      afterClarification,
    );
    expect(s.profile).toEqual(ready.profile);
    expect(s.profile).not.toHaveProperty('region');
  });

  it('AC-CONV-04: ready adds a ready turn, clears the violations and keeps the composer open', () => {
    const s = run(
      [
        { type: 'send', request: second },
        { type: 'succeeded', response: ready },
      ],
      afterClarification,
    );
    expect(s.turns.at(-1)).toEqual({ role: 'assistant', id: 't4', kind: 'ready' });
    expect(s.status).toBe('ready');
    expect(s.violations).toEqual([]);
    expect(canSend(s)).toBe(true);
  });

  it('ignores a response when nothing is in flight', () => {
    expect(reduce(initialState, { type: 'succeeded', response: ready })).toBe(initialState);
    expect(reduce(initialState, fail({ kind: 'network' }))).toBe(initialState);
  });
});

describe('errors and retry', () => {
  const sendingSecond = reduce(afterClarification, { type: 'send', request: second });

  it.each<ApiError>([
    { kind: 'upstream', refusal: false },
    { kind: 'network' },
    { kind: 'server', status: 500 },
    { kind: 'contract', detail: 'x' },
    { kind: 'invalid_request', message: 'x' },
    { kind: 'rate_limited', retryAfterSeconds: 30 },
    { kind: 'quota_exhausted' },
    { kind: 'message_too_long' },
  ])('AC-CONV-09: $kind keeps the turn and request, and restores the earlier status', (error) => {
    const s = reduce(sendingSecond, fail(error));
    expect(s.error).toEqual(error);
    expect(s.pending).toBe(second);
    expect(s.status).toBe('needs_clarification');
    expect(s.profile).toEqual(clarification.profile);
    expect(canSend(s)).toBe(true);
  });

  it('AC-CONV-09: a failed first turn goes back to idle, so the composer is usable', () => {
    const s = run([{ type: 'send', request: first }, fail({ kind: 'network' })]);
    expect(s.status).toBe('idle');
    expect(canSend(s)).toBe(true);
  });

  it('AC-CONV-09: retry re-sends the identical request without a second user turn', () => {
    const failed = reduce(sendingSecond, fail({ kind: 'network' }));
    const retried = reduce(failed, { type: 'retry' });
    expect(retried.status).toBe('sending');
    expect(retried.pending).toBe(second);
    expect(retried.error).toBeUndefined();
    expect(retried.turns).toEqual(failed.turns);
    expect(retried.settled).toBe('needs_clarification');
  });

  it('AC-CONV-09: retry does nothing when there is nothing to retry or a turn is in flight', () => {
    expect(reduce(initialState, { type: 'retry' })).toBe(initialState);
    expect(reduce(sendingSecond, { type: 'retry' })).toBe(sendingSecond);
  });

  it('AC-CONV-08: an abort the hook did not ask for just settles the turn', () => {
    const s = reduce(sendingSecond, fail({ kind: 'aborted' }));
    expect(s.status).toBe('needs_clarification');
    expect(s.error).toBeUndefined();
    expect(s.pending).toBe(second);
  });

  it('AC-CONV-08: reset clears everything', () => {
    expect(reduce(sendingSecond, { type: 'reset' })).toEqual(initialState);
  });
});

describe('invite code', () => {
  const sendingFirst = reduce(initialState, { type: 'send', request: first });

  it('AC-CONV-10: a 401 with no stored code asks for one, and blocks the composer', () => {
    const s = reduce(sendingFirst, fail({ kind: 'unauthorized' }, false));
    expect(s.invite).toBe('asking');
    expect(s.error).toBeUndefined();
    expect(s.pending).toBe(first);
    expect(canSend(s)).toBe(false);
  });

  it('AC-CONV-10: a 401 when a code was sent says the code is not valid', () => {
    expect(reduce(sendingFirst, fail({ kind: 'unauthorized' }, true)).invite).toBe('rejected');
  });

  it('AC-CONV-11: a 401 on a code from an invite link goes straight to rejected', () => {
    // The link's code is stored before the first send, so the hook reports hadInviteCode.
    expect(reduce(sendingFirst, fail({ kind: 'unauthorized' }, true)).invite).toBe('rejected');
  });

  it('AC-CONV-10: submitting a code retries the pending turn', () => {
    const asking = reduce(sendingFirst, fail({ kind: 'unauthorized' }));
    const s = reduce(asking, { type: 'inviteSubmitted' });
    expect(s.invite).toBe('none');
    expect(s.status).toBe('sending');
    expect(s.pending).toBe(first);
  });

  it('AC-CONV-10: a successful turn clears the code entry state', () => {
    const asking = reduce(sendingFirst, fail({ kind: 'unauthorized' }));
    const s = run(
      [{ type: 'inviteSubmitted' }, { type: 'succeeded', response: clarification }],
      asking,
    );
    expect(s.invite).toBe('none');
  });
});
