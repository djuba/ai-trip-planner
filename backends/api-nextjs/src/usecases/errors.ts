// Failures a use case can report. Here, not in src/llm, so that use cases can reference them and
// src/http can map them without either depending on the LlmClient implementation (CLAUDE.md §9).

export type LlmErrorCode = 'LLM_REFUSAL' | 'LLM_UPSTREAM_ERROR';

/** The model refused, or the provider failed after the single retry. Maps to a 502 (§5, §7). */
export class LlmError extends Error {
  readonly code: LlmErrorCode;

  constructor(code: LlmErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LlmError';
    this.code = code;
  }
}

/**
 * `/recommend` got a profile that breaks a rule, so it isn't `ready` (CLAUDE.md §5, §7; WU-10 plan
 * D7). Maps to a 422 `VALIDATION_FAILED`; no model is called.
 */
export class ProfileNotReadyError extends Error {
  readonly codes: readonly string[];

  constructor(codes: readonly string[]) {
    const unique = [...new Set(codes)];
    super(`The profile is not ready for recommendations: ${unique.join(', ')}`);
    this.name = 'ProfileNotReadyError';
    this.codes = unique;
  }
}
