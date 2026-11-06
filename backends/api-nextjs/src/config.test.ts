import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';

const SECRET = 'sk-ant-SENTINEL-do-not-leak';

const base = {
  LLM_MODE: 'replay',
  MODEL_FAST: 'fast-model',
  MODEL_REASONING: 'reasoning-model',
  MODEL_CRITIC: 'critic-model',
};

function failure(env: Record<string, string | undefined>): ConfigError {
  try {
    loadConfig(env);
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    return e as ConfigError;
  }
  throw new Error('expected loadConfig to throw');
}

describe('loadConfig', () => {
  it('AC-API-13: complete env yields a typed Config', () => {
    expect(
      loadConfig({ ...base, WEB_ORIGIN: 'http://localhost:5173', ANTHROPIC_API_KEY: SECRET }),
    ).toEqual({
      llmMode: 'replay',
      models: { fast: 'fast-model', reasoning: 'reasoning-model', critic: 'critic-model' },
      webOrigin: 'http://localhost:5173',
      anthropicApiKey: SECRET,
    });
  });

  it('AC-API-13: missing or blank WEB_ORIGIN takes the default', () => {
    expect(loadConfig(base).webOrigin).toBe('http://localhost:3000');
    expect(loadConfig({ ...base, WEB_ORIGIN: '  ' }).webOrigin).toBe('http://localhost:3000');
  });

  it('AC-API-13: blank ANTHROPIC_API_KEY is treated as unset', () => {
    expect(loadConfig({ ...base, ANTHROPIC_API_KEY: '' })).not.toHaveProperty('anthropicApiKey');
  });

  it('AC-API-13: a blank required variable is an error', () => {
    expect(failure({ ...base, MODEL_FAST: '   ' }).variables).toEqual(['MODEL_FAST']);
  });

  it('AC-API-14: every bad variable is named and no value leaks', () => {
    const err = failure({
      LLM_MODE: SECRET,
      MODEL_FAST: undefined,
      MODEL_REASONING: '',
      MODEL_CRITIC: 'ok',
      WEB_ORIGIN: `${SECRET}/path/`,
      ANTHROPIC_API_KEY: SECRET,
    });
    expect([...err.variables].sort()).toEqual(
      ['LLM_MODE', 'MODEL_FAST', 'MODEL_REASONING', 'WEB_ORIGIN'].sort(),
    );
    for (const name of err.variables) expect(err.message).toContain(name);
    expect(err.message).not.toContain(SECRET);
    expect(err.message).not.toContain('ok');
  });

  it('AC-API-14: a missing LLM_MODE has no default', () => {
    expect(failure({ ...base, LLM_MODE: undefined }).variables).toEqual(['LLM_MODE']);
  });

  it.each(['live', 'record'])('AC-API-15: %s without ANTHROPIC_API_KEY is an error', (mode) => {
    const err = failure({ ...base, LLM_MODE: mode });
    expect(err.variables).toEqual(['ANTHROPIC_API_KEY']);
    expect(failure({ ...base, LLM_MODE: mode, ANTHROPIC_API_KEY: ' ' }).variables).toEqual([
      'ANTHROPIC_API_KEY',
    ]);
  });

  it.each(['live', 'record'])('AC-API-15: %s with ANTHROPIC_API_KEY is ok', (mode) => {
    expect(loadConfig({ ...base, LLM_MODE: mode, ANTHROPIC_API_KEY: SECRET }).llmMode).toBe(mode);
  });

  it.each(['replay', 'mock'])('AC-API-15: %s without ANTHROPIC_API_KEY is ok', (mode) => {
    expect(loadConfig({ ...base, LLM_MODE: mode }).llmMode).toBe(mode);
  });

  it.each([
    'http://localhost:3000/',
    'http://localhost:3000/app',
    'localhost:3000',
    'not a url',
    'http://localhost:3000?x=1',
  ])('AC-API-16: WEB_ORIGIN %s is rejected', (origin) => {
    expect(failure({ ...base, WEB_ORIGIN: origin }).variables).toEqual(['WEB_ORIGIN']);
  });

  it('AC-API-16: a bare https origin is accepted', () => {
    expect(loadConfig({ ...base, WEB_ORIGIN: 'https://example.com' }).webOrigin).toBe(
      'https://example.com',
    );
  });
});
