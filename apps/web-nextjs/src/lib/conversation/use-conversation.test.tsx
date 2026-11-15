// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { buildFixture } from '@vp/domain-schema/testing';
import { ExtractResponse, type ExtractRequest } from '@vp/domain-schema/wire';
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
  return { client: { extract }, calls, answer };
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
