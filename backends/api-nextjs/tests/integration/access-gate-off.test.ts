// ACCESS_GATE=off through the production gate wiring (AC-GATE-19). Its own file: the gate reads
// the environment once per module instance, and every other file runs with the gate on.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { route } from '../../src/http/route.ts';
import { stubInviteEnv } from '../support/stub-invite-env.ts';

describe('ACCESS_GATE=off', () => {
  beforeAll(() => {
    vi.stubEnv('LLM_MODE', 'mock');
    vi.stubEnv('MODEL_FAST', 'fast');
    vi.stubEnv('MODEL_REASONING', 'reasoning');
    vi.stubEnv('MODEL_CRITIC', 'critic');
    vi.stubEnv('K_SERVICE', '');
    stubInviteEnv({ ACCESS_GATE: 'off', INVITE_CODES: '' });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('AC-GATE-19: a trip request with no code reaches its handler, uncounted', async () => {
    const handler = route(() => new Response('handled'));
    for (let i = 0; i < 5; i += 1) {
      const response = await handler(
        new Request('http://api.test/v1/trip/recommend', { method: 'POST' }),
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('handled');
    }
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('ACCESS_GATE=off'));
  });
});
