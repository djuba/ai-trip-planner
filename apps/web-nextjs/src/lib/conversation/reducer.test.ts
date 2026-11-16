import { buildFixture } from '@vp/domain-schema/testing';
import {
  ExtractRequest,
  ExtractResponse,
  PresentationModel,
  RecommendRequest,
  RecommendResponse,
} from '@vp/domain-schema/wire';
import { describe, expect, it } from 'vitest';
import type { ApiError } from '../api';
import {
  canRecommend,
  canSend,
  conversationReducer as reduce,
  initialState,
  tripInFlight,
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

describe('recommendations (WU-14)', () => {
  const recommendRequest = buildFixture(RecommendRequest, {
    profile: ready.profile,
    referenceDate: '2030-01-15',
  });
  const recommendResponse = buildFixture(RecommendResponse, {
    recommendations: [
      {
        id: 'rec-1',
        destination: 'Maui, Hawaii',
        summary: 'Warm beaches.',
        matchedExperiences: ['beach'],
        claims: [],
      },
      {
        id: 'rec-2',
        destination: 'Cancún, Mexico',
        summary: 'Warm water.',
        matchedExperiences: [],
        claims: [],
      },
    ],
    critique: { pass: true, unresolved: [] },
  });
  const model = buildFixture(PresentationModel, {
    headline: 'Two warm trips',
    intro: 'Both are warm in March.',
    cards: [],
  });
  const tripFail = (
    step: 'recommend' | 'present',
    error: ApiError,
    hadInviteCode = false,
  ): Action => ({ type: 'tripFailed', step, error, hadInviteCode });

  const atReady = run([
    { type: 'send', request: first },
    { type: 'succeeded', response: ready },
  ]);
  const recommending = reduce(atReady, { type: 'recommendRequested', request: recommendRequest });
  const presenting = reduce(recommending, {
    type: 'recommendSucceeded',
    response: recommendResponse,
  });
  const presented = reduce(presenting, { type: 'presentFinished', model });

  it('AC-CARDS-01: recommendations are offered only at a settled ready profile', () => {
    expect(canRecommend(initialState)).toBe(false);
    expect(canRecommend(afterClarification)).toBe(false);
    expect(canRecommend(atReady)).toBe(true);
    expect(
      reduce(afterClarification, { type: 'recommendRequested', request: recommendRequest }),
    ).toBe(afterClarification);
  });

  it('AC-CARDS-01: requesting holds the recommend request', () => {
    expect(recommending.trip).toEqual({ step: 'recommending', request: recommendRequest });
    expect(canRecommend(recommending)).toBe(false);
    expect(reduce(recommending, { type: 'recommendRequested', request: recommendRequest })).toBe(
      recommending,
    );
  });

  it('AC-CARDS-02: the present request is the profile plus the recommendations, in order', () => {
    expect(presenting.trip).toEqual({
      step: 'presenting',
      recommend: recommendResponse,
      request: { profile: ready.profile, recommendations: recommendResponse.recommendations },
    });
  });

  it('AC-CARDS-05: a finished stream keeps the validated model', () => {
    expect(presented.trip).toEqual({ step: 'presented', recommend: recommendResponse, model });
  });

  it('AC-CARDS-10: no turn can start while a trip step is in flight', () => {
    expect(tripInFlight(recommending)).toBe(true);
    expect(tripInFlight(presenting)).toBe(true);
    expect(tripInFlight(presented)).toBe(false);
    expect(canSend(recommending)).toBe(false);
    expect(canSend(presenting)).toBe(false);
    expect(canSend(presented)).toBe(true);
    expect(reduce(presenting, { type: 'send', request: second })).toBe(presenting);
  });

  it('AC-CARDS-10: reset clears the results', () => {
    expect(reduce(presenting, { type: 'reset' })).toEqual(initialState);
  });

  it('AC-CARDS-11: a new extract response clears the results', () => {
    const s = run(
      [
        { type: 'send', request: second },
        { type: 'succeeded', response: ready },
      ],
      presented,
    );
    expect(s.trip).toEqual({ step: 'none' });
    expect(canRecommend(s)).toBe(true);
  });

  it('AC-CARDS-11: the results stay while a correction is in flight', () => {
    const s = reduce(presented, { type: 'send', request: second });
    expect(s.trip).toBe(presented.trip);
  });

  it('plan fix 5: results arriving in another step are dropped', () => {
    expect(reduce(atReady, { type: 'recommendSucceeded', response: recommendResponse })).toBe(
      atReady,
    );
    expect(reduce(presenting, { type: 'recommendSucceeded', response: recommendResponse })).toBe(
      presenting,
    );
    expect(reduce(recommending, { type: 'presentFinished', model })).toBe(recommending);
    expect(reduce(presented, { type: 'presentFinished', model })).toBe(presented);
    expect(reduce(presenting, tripFail('recommend', { kind: 'network' }))).toBe(presenting);
    expect(reduce(recommending, tripFail('present', { kind: 'network' }))).toBe(recommending);
    expect(reduce(atReady, tripFail('present', { kind: 'network' }))).toBe(atReady);
  });

  it('AC-CARDS-07: a recommend failure keeps its request, and Retry resends it', () => {
    const failed = reduce(recommending, tripFail('recommend', { kind: 'network' }));
    expect(failed.trip).toEqual({
      step: 'failed',
      failedStep: 'recommend',
      error: { kind: 'network' },
      request: recommendRequest,
    });
    expect(canSend(failed)).toBe(true);
    expect(reduce(failed, { type: 'tripRetry' }).trip).toEqual(recommending.trip);
  });

  it('AC-CARDS-06: Retry after a present failure resends only /present, with the same body', () => {
    const failed = reduce(presenting, tripFail('present', { kind: 'interrupted' }));
    expect(failed.trip).toMatchObject({ step: 'failed', failedStep: 'present' });
    const retried = reduce(failed, { type: 'tripRetry' });
    expect(retried.trip).toEqual(presenting.trip);
    if (retried.trip.step !== 'presenting' || presenting.trip.step !== 'presenting') {
      throw new Error('step');
    }
    expect(retried.trip.request).toBe(presenting.trip.request);
  });

  it('AC-CARDS-06: Retry does nothing unless a step failed', () => {
    expect(reduce(presenting, { type: 'tripRetry' })).toBe(presenting);
    expect(reduce(atReady, { type: 'tripRetry' })).toBe(atReady);
  });

  it('AC-CARDS-07: an abort the hook did not ask for just ends the step', () => {
    expect(reduce(presenting, tripFail('present', { kind: 'aborted' })).trip).toEqual({
      step: 'none',
    });
  });

  it('AC-CARDS-07: a 401 asks for a code, and submitting one resends that step', () => {
    const asking = reduce(presenting, tripFail('present', { kind: 'unauthorized' }, false));
    expect(asking.invite).toBe('asking');
    expect(canSend(asking)).toBe(false);
    const resent = reduce(asking, { type: 'inviteSubmitted' });
    expect(resent.invite).toBe('none');
    expect(resent.trip).toEqual(presenting.trip);
    expect(resent.status).toBe('ready');

    const rejected = reduce(recommending, tripFail('recommend', { kind: 'unauthorized' }, true));
    expect(rejected.invite).toBe('rejected');
    expect(reduce(rejected, { type: 'inviteSubmitted' }).trip).toEqual(recommending.trip);
  });

  it('plan fix 3: an invite code with nothing to resend only closes the entry', () => {
    const failed = reduce(presenting, tripFail('present', { kind: 'network' }));
    const s = reduce({ ...failed, invite: 'asking' }, { type: 'inviteSubmitted' });
    expect(s.invite).toBe('none');
    expect(s.trip).toBe(failed.trip);
  });
});
