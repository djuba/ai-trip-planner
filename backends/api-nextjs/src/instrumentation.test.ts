import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('register', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('LLM_MODE', 'mock');
    vi.stubEnv('MODEL_FAST', 'fast-model');
    vi.stubEnv('MODEL_REASONING', 'reasoning-model');
    vi.stubEnv('MODEL_CRITIC', 'critic-model');
    vi.stubEnv('WEB_ORIGIN', '');
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('AC-API-17: a valid env starts normally', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const { register } = await import('./instrumentation.ts');
    register();
    expect(exit).not.toHaveBeenCalled();
  });

  it('AC-API-17: an invalid env logs the variable name and exits with code 1', async () => {
    vi.stubEnv('LLM_MODE', 'bogus');
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { register } = await import('./instrumentation.ts');
    register();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('LLM_MODE'));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('skips validation outside the Node.js runtime, where process.exit does not exist', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    vi.stubEnv('LLM_MODE', 'bogus');
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const { register } = await import('./instrumentation.ts');
    register();
    expect(exit).not.toHaveBeenCalled();
  });
});
