// The boundary every pipeline stage calls (CLAUDE.md §7, §9). Use cases own this interface; src/llm
// implements it with the AI SDK, and its mock mode runs the same implementation over a mock model.
// Nothing here names the SDK, so the lint rule that keeps it out of src/usecases holds.
import type { z } from 'zod';

/** A pipeline stage. Used to label logs and to pick a mock reply. */
export type LlmStage = 'extract' | 'clarify' | 'recommend' | 'critic' | 'present';

/** Which configured model runs the call: MODEL_FAST, MODEL_REASONING or MODEL_CRITIC (§8.1). */
export type ModelRole = 'fast' | 'reasoning' | 'critic';

/** Anthropic `effort`; the only tuning knob, since sampling params are never sent (§8.2). */
export type LlmEffort = 'low' | 'medium' | 'high';

export interface LlmObjectRequest<T> {
  stage: LlmStage;
  role: ModelRole;
  /** What the model must fill in. Only ADR 0001 Q3 "use" constructs (§4.4). */
  schema: z.ZodType<T>;
  /** Static and byte-stable: no dates or IDs, so prompt caching and cassette keys hold (§8.3). */
  system: string;
  /** The user message. Per-request data such as `referenceDate` goes here. */
  prompt: string;
  /** Required, so no stage falls back to the 128k model maximum (ADR 0001 Q4). */
  maxOutputTokens: number;
  effort: LlmEffort;
}

export interface LlmClient {
  /**
   * Resolves with output that passed `schema.safeParse`. Rejects with `LlmError` (`LLM_REFUSAL` or
   * `LLM_UPSTREAM_ERROR`, after the one retry) for anything that maps to a 502. Any other rejection
   * is a bug or a test-setup error, such as a cassette miss, and maps to a 500.
   */
  generateObject<T>(request: LlmObjectRequest<T>): Promise<T>;
}
