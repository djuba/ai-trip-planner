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

  it('AC-GATE-08: live mode without invite codes refuses to start, naming the variable', async () => {
    vi.stubEnv('LLM_MODE', 'live');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-SENTINEL');
    vi.stubEnv('INVITE_CODES', '');
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { register } = await import('./instrumentation.ts');
    register();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('INVITE_CODES'));
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('SENTINEL'));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('AC-GATE-08: mock mode without invite codes starts, warning that every trip request is refused', async () => {
    vi.stubEnv('INVITE_CODES', '');
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { register } = await import('./instrumentation.ts');
    register();
    expect(exit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('401'));
  });

  it('AC-GATE-19: ACCESS_GATE=off starts in live mode with a warning that nothing caps spend', async () => {
    vi.stubEnv('LLM_MODE', 'live');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-SENTINEL');
    vi.stubEnv('ACCESS_GATE', 'off');
    vi.stubEnv('K_SERVICE', '');
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { register } = await import('./instrumentation.ts');
    register();
    expect(exit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ACCESS_GATE=off'));
  });

  it('AC-GATE-19: ACCESS_GATE=off on Cloud Run refuses to start', async () => {
    vi.stubEnv('ACCESS_GATE', 'off');
    vi.stubEnv('K_SERVICE', 'api');
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { register } = await import('./instrumentation.ts');
    register();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('ACCESS_GATE'));
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
