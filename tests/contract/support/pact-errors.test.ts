import { describe, expect, it } from 'vitest';
import { NATIVE_HINT, explainPactError } from './pact-errors.ts';

describe('explainPactError', () => {
  it('AC-CONTRACT-08: turns the native load failure into an install hint', () => {
    // The exact error seen on Windows without the Visual C++ runtime (WU-07 plan X1).
    const original = new TypeError(
      "Cannot read properties of undefined (reading 'pactffiInitWithLogLevel')",
    );
    const explained = explainPactError(original);
    expect(explained).toBeInstanceOf(Error);
    expect((explained as Error).message).toBe(
      `${NATIVE_HINT}\nOriginal error: ${original.message}`,
    );
    expect((explained as Error).cause).toBe(original);
  });

  it('leaves other errors unchanged', () => {
    const verification = new Error('Verification failed: 1 interaction');
    const otherTypeError = new TypeError("Cannot read properties of undefined (reading 'x')");
    expect(explainPactError(verification)).toBe(verification);
    expect(explainPactError(otherTypeError)).toBe(otherTypeError);
    expect(explainPactError('not an error')).toBe('not an error');
  });
});
