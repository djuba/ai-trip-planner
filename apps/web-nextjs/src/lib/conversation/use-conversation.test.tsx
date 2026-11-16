// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { buildFixture } from '@vp/domain-schema/testing';
import {
  ExtractResponse,
  PresentationModel,
  RecommendResponse,
  type ExtractRequest,
  type PresentRequest,
  type RecommendRequest,
} from '@vp/domain-schema/wire';
import { describe, expect, it, vi } from 'vitest';
import type { ApiClient, ApiResult, RequestOptions } from '../api';
import type { InviteStore } from '../invite';
import { useConversation } from './use-conversation';

const clarification = buildFixture(ExtractResponse, {
  status: 'needs_clarification',
  profile: { climate: 'warm' },
  violations: [{ code: 'INSUFFICIENT_DETAIL', path: '', params: { populated: 1, required: 3 } }],
  clarificationQuestion: 'Where would you like to go, and when?',
});
const ready = buildFixture(ExtractResponse, { status: 'ready', profile: { climate: 'warm' } });

type Extract = ApiClient['extract'];
type Call = { body: ExtractRequest; signal: AbortSignal | undefined };

/** A fake client whose answers the test releases one at a time. */
function fakeClient() {
  const calls: Call[] = [];
  const answers: ((r: ApiResult<ExtractResponse>) => void)[] = [];
  const extract = vi.fn<Extract>((body: ExtractRequest, init?: RequestOptions) => {
    calls.push({ body, signal: init?.signal });
    return new Promise((resolve) => answers.push(resolve));
  });
  const answer = async (result: ApiResult<ExtractResponse>) => {
    await act(async () => {
      answers.shift()?.(result);
      await Promise.resolve();
    });
  };

  const recommendCalls: { body: RecommendRequest; signal: AbortSignal | undefined }[] = [];
  const recommendAnswers: ((r: ApiResult<RecommendResponse>) => void)[] = [];
  const recommend = vi.fn<ApiClient['recommend']>((body, init) => {
    recommendCalls.push({ body, signal: init?.signal });
    return new Promise((resolve) => recommendAnswers.push(resolve));
  });
  const answerRecommend = async (result: ApiResult<RecommendResponse>) => {
    await act(async () => {
      recommendAnswers.shift()?.(result);
      await Promise.resolve();
    });
  };

  // Each `/present` call gets a stream the test writes to and closes.
  const presentCalls: { body: PresentRequest; signal: AbortSignal | undefined }[] = [];
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const present = vi.fn<ApiClient['present']>((body, init) => {
    presentCalls.push({ body, signal: init?.signal });
    const stream = new ReadableStream<Uint8Array>({ start: (c) => void streams.push(c) });
    return Promise.resolve({ ok: true, data: stream });
  });
  const writePresent = async (text: string, close = false) => {
    await act(async () => {
      const controller = streams.at(-1);
      controller?.enqueue(new TextEncoder().encode(text));
      if (close) controller?.close();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  return {
    client: { extract, recommend, present },
    calls,
    answer,
    recommendCalls,
    answerRecommend,
    presentCalls,
    writePresent,
  };
}

function memoryInvites(initial?: string): InviteStore {
  let code = initial;
  return {
    get: () => code,
    set: (c) => {
      code = c;
    },
  };
}

const today = () => '2030-01-15';

function setup(invites: InviteStore = memoryInvites()) {
  const fake = fakeClient();
  const hook = renderHook(() => useConversation({ client: fake.client, invites, today }));
  return { ...fake, hook, invites };
}

describe('useConversation', () => {
  it('AC-CONV-01: the first turn sends the message and today, with no currentProfile', async () => {
    const { hook, calls } = setup();
    act(() => hook.result.current.send('Somewhere warm'));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toEqual({ message: 'Somewhere warm', referenceDate: '2030-01-15' });
    expect(hook.result.current.state.status).toBe('sending');
  });

  it('AC-CONV-03: the next turn sends the last response profile as currentProfile', async () => {
    const { hook, calls, answer } = setup();
    act(() => hook.result.current.send('Somewhere warm'));
    await waitFor(() => expect(calls).toHaveLength(1));
    await answer({ ok: true, data: clarification });
    expect(hook.result.current.state.status).toBe('needs_clarification');

    act(() => hook.result.current.send('Hawaii in March'));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]?.body).toEqual({
      message: 'Hawaii in March',
      currentProfile: clarification.profile,
      referenceDate: '2030-01-15',
    });
    await answer({ ok: true, data: ready });
    expect(hook.result.current.state.status).toBe('ready');
  });

  it('AC-CONV-09: retry sends the identical request again', async () => {
    const { hook, calls, answer } = setup();
    act(() => hook.result.current.send('Somewhere warm'));
    await waitFor(() => expect(calls).toHaveLength(1));
    await answer({ ok: false, error: { kind: 'network' } });
    expect(hook.result.current.state.error).toEqual({ kind: 'network' });

    act(() => hook.result.current.retry());
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]?.body).toBe(calls[0]?.body);
  });

  it('AC-CONV-08: start over aborts the request in flight and drops its result', async () => {
    const { hook, calls, answer } = setup();
    act(() => hook.result.current.send('Somewhere warm'));
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => hook.result.current.reset());
    expect(calls[0]?.signal?.aborted).toBe(true);
    await answer({ ok: true, data: clarification });
    expect(hook.result.current.state.turns).toEqual([]);
    expect(hook.result.current.state.status).toBe('idle');
  });

  it('AC-CONV-08: unmounting aborts the request in flight', async () => {
    const { hook, calls } = setup();
    act(() => hook.result.current.send('Somewhere warm'));
    await waitFor(() => expect(calls).toHaveLength(1));
    hook.unmount();
    expect(calls[0]?.signal?.aborted).toBe(true);
  });

  it('AC-CONV-10: a 401 with no code asks; submitting a code stores it and retries', async () => {
    const { hook, calls, answer, invites } = setup();
    act(() => hook.result.current.send('Somewhere warm'));
    await waitFor(() => expect(calls).toHaveLength(1));
    await answer({ ok: false, error: { kind: 'unauthorized' } });
    expect(hook.result.current.state.invite).toBe('asking');

    act(() => hook.result.current.submitInvite('  abc-123  '));
    expect(invites.get()).toBe('abc-123');
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]?.body).toBe(calls[0]?.body);

    await answer({ ok: false, error: { kind: 'unauthorized' } });
    expect(hook.result.current.state.invite).toBe('rejected');
  });

  it('AC-CONV-11: a 401 on a stored code (from an invite link) says it is not valid', async () => {
    const { hook, calls, answer } = setup(memoryInvites('from-link'));
    act(() => hook.result.current.send('Somewhere warm'));
    await waitFor(() => expect(calls).toHaveLength(1));
    await answer({ ok: false, error: { kind: 'unauthorized' } });
    expect(hook.result.current.state.invite).toBe('rejected');
  });
});

describe('useConversation: recommendations (WU-14)', () => {
  const recommendation = {
    id: 'rec-1',
    destination: 'Maui, Hawaii',
    summary: 'Warm beaches.',
    matchedExperiences: [],
    claims: [
      { kind: 'flight', statement: 'Flights may need one stop.', verification: 'unverified' },
    ],
  } as const;
  const recommended = buildFixture(RecommendResponse, {
    recommendations: [recommendation],
    critique: { pass: true, unresolved: [] },
  });
  const model = buildFixture(PresentationModel, {
    headline: 'One warm trip',
    intro: 'Maui is warm.',
    cards: [
      {
        recommendationId: 'rec-1',
        claims: [...recommendation.claims],
        title: 'Maui',
        blurb: 'Calm turquoise bays.',
        highlights: ['Snorkeling'],
      },
    ],
  });
  const text = JSON.stringify(model);

  async function atReady(invites?: InviteStore) {
    const s = setup(invites);
    act(() => s.hook.result.current.send('Somewhere warm'));
    await waitFor(() => expect(s.calls).toHaveLength(1));
    await s.answer({ ok: true, data: ready });
    return s;
  }

  async function atPresenting(invites?: InviteStore) {
    const s = await atReady(invites);
    act(() => s.hook.result.current.getRecommendations());
    await waitFor(() => expect(s.recommendCalls).toHaveLength(1));
    await s.answerRecommend({ ok: true, data: recommended });
    await waitFor(() => expect(s.presentCalls).toHaveLength(1));
    return s;
  }

  it('AC-CARDS-01: nothing is requested until asked; then /recommend gets the profile and today', async () => {
    const s = await atReady();
    expect(s.recommendCalls).toHaveLength(0);
    act(() => s.hook.result.current.getRecommendations());
    await waitFor(() => expect(s.recommendCalls).toHaveLength(1));
    expect(s.recommendCalls[0]?.body).toEqual({
      profile: ready.profile,
      referenceDate: '2030-01-15',
    });
    expect(s.hook.result.current.state.trip.step).toBe('recommending');
  });

  it('AC-CARDS-02: /present gets the profile and the recommendations unchanged', async () => {
    const s = await atPresenting();
    expect(s.presentCalls[0]?.body).toEqual({
      profile: ready.profile,
      recommendations: recommended.recommendations,
    });
  });

  it('AC-CARDS-03 AC-CARDS-05: partials stream in, then the validated model is kept', async () => {
    const s = await atPresenting();
    await s.writePresent(text.slice(0, 40));
    await waitFor(() =>
      expect(s.hook.result.current.partial).toMatchObject({ headline: 'One warm trip' }),
    );
    expect(s.hook.result.current.state.trip.step).toBe('presenting');
    await s.writePresent(text.slice(40), true);
    await waitFor(() => expect(s.hook.result.current.state.trip.step).toBe('presented'));
    const { trip } = s.hook.result.current.state;
    expect(trip.step === 'presented' ? trip.model : undefined).toEqual(model);
    // Leaving `presenting` clears the partial object (plan fix 2).
    await waitFor(() => expect(s.hook.result.current.partial).toBeUndefined());
  });

  it('AC-CARDS-05: a final object that fails the schema is a contract error', async () => {
    const s = await atPresenting();
    await s.writePresent('{"headline":"x","intro":"y"}', true);
    await waitFor(() => expect(s.hook.result.current.state.trip.step).toBe('failed'));
    const { trip } = s.hook.result.current.state;
    expect(trip.step === 'failed' ? trip.error.kind : undefined).toBe('contract');
  });

  it('AC-CARDS-06: Retry sends /present again with the same body and no new /recommend', async () => {
    const s = await atPresenting();
    await s.writePresent('{"headline":"x","intro":"y"}', true);
    await waitFor(() => expect(s.hook.result.current.state.trip.step).toBe('failed'));
    act(() => s.hook.result.current.retryTrip());
    await waitFor(() => expect(s.presentCalls).toHaveLength(2));
    expect(s.presentCalls[1]?.body).toEqual(s.presentCalls[0]?.body);
    expect(s.recommendCalls).toHaveLength(1);
  });

  it('AC-CARDS-07: a /recommend failure fails the step, and Retry resends it', async () => {
    const s = await atReady();
    act(() => s.hook.result.current.getRecommendations());
    await waitFor(() => expect(s.recommendCalls).toHaveLength(1));
    await s.answerRecommend({ ok: false, error: { kind: 'upstream', refusal: false } });
    expect(s.hook.result.current.state.trip.step).toBe('failed');
    act(() => s.hook.result.current.retryTrip());
    await waitFor(() => expect(s.recommendCalls).toHaveLength(2));
    expect(s.recommendCalls[1]?.body).toBe(s.recommendCalls[0]?.body);
  });

  it('AC-CARDS-07: a 401 on /recommend asks for a code, then resends with it', async () => {
    const s = await atReady();
    act(() => s.hook.result.current.getRecommendations());
    await waitFor(() => expect(s.recommendCalls).toHaveLength(1));
    await s.answerRecommend({ ok: false, error: { kind: 'unauthorized' } });
    expect(s.hook.result.current.state.invite).toBe('asking');
    act(() => s.hook.result.current.submitInvite('abc'));
    await waitFor(() => expect(s.recommendCalls).toHaveLength(2));
  });

  it('AC-CARDS-10: Start over aborts /recommend and drops its result', async () => {
    const s = await atReady();
    act(() => s.hook.result.current.getRecommendations());
    await waitFor(() => expect(s.recommendCalls).toHaveLength(1));
    act(() => s.hook.result.current.reset());
    expect(s.recommendCalls[0]?.signal?.aborted).toBe(true);
    await s.answerRecommend({ ok: true, data: recommended });
    expect(s.hook.result.current.state.trip.step).toBe('none');
    expect(s.presentCalls).toHaveLength(0);
  });

  it('AC-CARDS-10: Start over aborts the stream and clears the partial object', async () => {
    const s = await atPresenting();
    await s.writePresent(text.slice(0, 40));
    await waitFor(() => expect(s.hook.result.current.partial).toBeDefined());
    act(() => s.hook.result.current.reset());
    expect(s.presentCalls[0]?.signal?.aborted).toBe(true);
    await waitFor(() => expect(s.hook.result.current.partial).toBeUndefined());
    expect(s.hook.result.current.state.trip.step).toBe('none');
  });
});
