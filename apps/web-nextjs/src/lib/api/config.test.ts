import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiBaseUrl, ConfigError } from './config.ts';

describe('apiBaseUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('AC-WEB-01: returns the value with trailing slashes removed', () => {
    expect(apiBaseUrl('http://127.0.0.1:4000/')).toBe('http://127.0.0.1:4000');
    expect(apiBaseUrl('http://127.0.0.1:4000')).toBe('http://127.0.0.1:4000');
  });

  it('AC-WEB-01: reads NEXT_PUBLIC_API_BASE_URL when called without an argument', () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://localhost:4000/');
    expect(apiBaseUrl()).toBe('http://localhost:4000');
  });

  it('AC-WEB-01: throws a ConfigError naming the variable when missing or blank', () => {
    expect(() => apiBaseUrl(undefined)).toThrow(ConfigError);
    expect(() => apiBaseUrl('   ')).toThrow(/NEXT_PUBLIC_API_BASE_URL/);
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '');
    expect(() => apiBaseUrl()).toThrow(ConfigError);
  });
});
