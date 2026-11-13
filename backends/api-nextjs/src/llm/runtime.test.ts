import { afterEach, describe, expect, it, vi } from 'vitest';

describe('getLlmRuntime', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('builds the runtime from the environment on first use, then reuses it', async () => {
    vi.stubEnv('LLM_MODE', 'replay');
    vi.stubEnv('MODEL_FAST', 'fast');
    vi.stubEnv('MODEL_REASONING', 'reasoning');
    vi.stubEnv('MODEL_CRITIC', 'critic');
    vi.stubEnv('LLM_CASSETTE_DIR', '.');
    const { getLlmRuntime } = await import('./runtime.ts');

    const first = getLlmRuntime();

    expect(first.client).toHaveProperty('generateObject');
    expect(getLlmRuntime()).toBe(first);
  });
});
