// Failures a use case can report. Here, not in src/llm, so that use cases can reference them and
// src/http can map them without either depending on the LlmClient implementation (CLAUDE.md §9).

export type LlmErrorCode = 'LLM_REFUSAL' | 'LLM_UPSTREAM_ERROR';

/** The model refused, or the provider failed after the single retry. Maps to a 502 (§5, §7). */
export class LlmError extends Error {
  readonly code: LlmErrorCode;
  /**
   * The failure came after a stream's first output (WU-11 plan D1, D5). Part of the response may
   * already be sent, so it can't become a 502: the response stream is errored instead.
   */
  readonly midStream: boolean;

  constructor(
    code: LlmErrorCode,
    message: string,
    options?: ErrorOptions & { midStream?: boolean },
  ) {
    super(message, options);
    this.name = 'LlmError';
    this.code = code;
    this.midStream = options?.midStream ?? false;
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
