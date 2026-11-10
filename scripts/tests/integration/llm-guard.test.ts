// Patches a fetch target, so it sits in the integration layer rather than the shared unit workers.
import { describe, expect, it } from 'vitest';
import {
  installNetworkGuard,
  isLoopbackHost,
  NETWORK_BLOCKED_MESSAGE,
  recordingAllowed,
} from '../../test-support/llm-guard.ts';

function fakeTarget() {
  const calls: string[] = [];
  const target = {
    fetch: ((input: string | URL | Request) => {
      calls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return Promise.resolve(new Response('ok'));
    }) as typeof fetch,
  };
  return { target, calls };
}

describe('network guard', () => {
  it.each(['https://api.anthropic.com/v1/messages', 'http://example.com', 'http://10.0.0.5:4000/'])(
    'AC-LLM-16: blocks %s',
    async (url) => {
      const { target, calls } = fakeTarget();
      installNetworkGuard(target);
      await expect(target.fetch(url)).rejects.toThrow(NETWORK_BLOCKED_MESSAGE);
      expect(calls).toEqual([]);
    },
  );

  it.each([
    'http://localhost:4000/v1/health',
    'http://127.0.0.1:53211/',
    'http://[::1]:3000/',
    'http://app.localhost/',
  ])('AC-LLM-16: allows loopback %s', async (url) => {
    const { target, calls } = fakeTarget();
    installNetworkGuard(target);
    await expect(target.fetch(url)).resolves.toBeInstanceOf(Response);
    expect(calls).toEqual([url]);
  });

  it('AC-LLM-16: checks URL and Request inputs, and restores the original fetch', async () => {
    const { target } = fakeTarget();
    const original = target.fetch;
    const restore = installNetworkGuard(target);
    await expect(target.fetch(new URL('https://api.anthropic.com'))).rejects.toThrow(
      NETWORK_BLOCKED_MESSAGE,
    );
    await expect(target.fetch(new Request('https://api.anthropic.com'))).rejects.toThrow(
      NETWORK_BLOCKED_MESSAGE,
    );
    restore();
    expect(target.fetch).toBe(original);
  });

  it('AC-LLM-16: this test process has the guard installed on the real fetch', async () => {
    await expect(fetch('https://api.anthropic.com/v1/messages')).rejects.toThrow(
      NETWORK_BLOCKED_MESSAGE,
    );
  });

  it('AC-LLM-16: loopback detection', () => {
    expect(isLoopbackHost('LOCALHOST')).toBe(true);
    expect(isLoopbackHost('127.255.0.1')).toBe(true);
    expect(isLoopbackHost('localhost.example.com')).toBe(false);
    expect(isLoopbackHost('128.0.0.1')).toBe(false);
  });
});

describe('recording gate', () => {
  it('AC-LLM-16: recording needs VP_LLM_RECORD=1 and the record:cassettes script', () => {
    expect(recordingAllowed({ VP_LLM_RECORD: '1', npm_lifecycle_event: 'record:cassettes' })).toBe(
      true,
    );
    expect(recordingAllowed({ VP_LLM_RECORD: '1', npm_lifecycle_event: 'verify' })).toBe(false);
    expect(recordingAllowed({ VP_LLM_RECORD: '1' })).toBe(false);
    expect(recordingAllowed({ npm_lifecycle_event: 'record:cassettes' })).toBe(false);
  });

  it('AC-LLM-16: gated runs see LLM_MODE=replay', () => {
    expect(process.env.LLM_MODE).toBe('replay');
  });
});
