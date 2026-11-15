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
  /**
   * Checks the output must also pass, after `schema`; never sent to the model. Use it for what
   * `schema` may not say, such as a length cap. A failure is invalid output: retried once, then
   * `LLM_UPSTREAM_ERROR`. It can only add checks; the output returned is the `schema` parse.
   */
  accept?: z.ZodType;
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

  /**
   * Streams the output as it is written (§7 stage 3; WU-11 plan D1). The promise settles once the
   * first partial is in: before that, failures are handled exactly as in `generateObject` (one
   * retry, then `LlmError`), because nothing has reached a client yet. After it there is no retry:
   * a failure (an upstream error, a refusal, a cut-off or output that fails `schema` or `accept`)
   * makes the iterator throw `LlmError` with `midStream: true`. The last part is always `final`,
   * with output that passed `schema` and `accept`. Every failure surfaces in the iterator, so none
   * can become an unhandled rejection. Ending the iteration early cancels the model call.
   */
  streamObject<T>(request: LlmObjectRequest<T>): Promise<AsyncIterable<LlmStreamPart<T>>>;
}

/** The output so far: any key may be missing, and the last string or array may be cut short. */
export type PartialObject<T> = T extends readonly (infer E)[]
  ? PartialObject<E>[]
  : T extends object
    ? { [K in keyof T]?: PartialObject<T[K]> }
    : T;

export type LlmStreamPart<T> =
  { type: 'partial'; partial: PartialObject<T> } | { type: 'final'; object: T };
