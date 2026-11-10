// The LlmClient over the AI SDK (CLAUDE.md §7, §8.2; ADR 0001 Decision; WU-08 plan D2, D3, D9).
// Every call: `generateText` + `Output.object`, native structured output, no SDK retries, an
// explicit token cap and `effort`, never sampling params. The refusal check comes before `output`,
// and the output is `safeParse`d again because model output is untrusted input.
import type { AnthropicLanguageModelOptions } from '@ai-sdk/anthropic';
import {
  APICallError,
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  type LanguageModel,
} from 'ai';
import { LlmError } from '../usecases/errors.ts';
import type { LlmClient, LlmObjectRequest, LlmStage, ModelRole } from '../usecases/llm-client.ts';
import { CassetteMissError } from './cassette-fetch.ts';

/** A model instance, not a gateway ID string, so the log can name the model. */
export type ResolvedModel = Exclude<LanguageModel, string>;

/** One line per attempt (§8.3). Messages and prompts are never logged. */
export interface LlmCallLog {
  stage: LlmStage;
  role: ModelRole;
  model: string;
  attempt: number;
  /** `retry`: this attempt failed and another follows. `error`: it failed and none does. */
  outcome: 'ok' | 'refusal' | 'retry' | 'error';
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  latencyMs: number;
  /** SDK warnings, such as a dropped option. Integration tests assert there are none. */
  warnings: string[];
  /** The failure's error name, when the attempt failed. */
  error?: string;
}

export interface AiSdkLlmClientDeps {
  modelFor: (role: ModelRole) => ResolvedModel;
  log: (entry: LlmCallLog) => void;
  /** A monotonic clock in milliseconds, injected so tests control latency (§6.1). */
  now: () => number;
}

/** Attempts per call: the first, plus the one retry §7 allows. */
export const MAX_ATTEMPTS = 2;

/** The model returned output the SDK accepted but our own `safeParse` rejected. */
class OutputInvalidError extends Error {
  constructor(options: ErrorOptions) {
    super('Model output failed schema validation', options);
    this.name = 'OutputInvalidError';
  }
}

function findCause<E extends Error>(
  error: unknown,
  type: abstract new (...args: never[]) => E,
): E | undefined {
  const seen = new Set<unknown>();
  for (let current = error; current != null && !seen.has(current);) {
    seen.add(current);
    if (current instanceof type) return current;
    current = current instanceof Error ? current.cause : undefined;
  }
  return undefined;
}

/**
 * The model hit `maxOutputTokens` before finishing. A retry repeats the same capped generation, so
 * anyone who can trigger the cap would cost two calls instead of one (WU-08 Note from security
 * planning). It fails at once: a 502 `LLM_UPSTREAM_ERROR` with no new wire code, because a client
 * can't act on it; the cause is our token cap.
 */
class OutputTruncatedError extends Error {
  constructor(options: ErrorOptions) {
    super('Model output was cut off at maxOutputTokens', options);
    this.name = 'OutputTruncatedError';
  }
}

type Failure =
  | { kind: 'retryable'; error: Error }
  | { kind: 'final'; error: Error }
  | { kind: 'rethrow'; error: unknown };

/** ADR 0001 Q5: which failures earn the one retry, which go straight to 502, which are bugs. */
function classify(error: unknown): Failure {
  const miss = findCause(error, CassetteMissError);
  if (miss !== undefined) return { kind: 'rethrow', error: miss };
  if (NoObjectGeneratedError.isInstance(error) && error.finishReason === 'length') {
    return { kind: 'final', error: new OutputTruncatedError({ cause: error }) };
  }
  if (
    error instanceof OutputInvalidError ||
    NoObjectGeneratedError.isInstance(error) ||
    NoOutputGeneratedError.isInstance(error)
  ) {
    return { kind: 'retryable', error };
  }
  if (APICallError.isInstance(error)) {
    return error.isRetryable ? { kind: 'retryable', error } : { kind: 'final', error };
  }
  return { kind: 'rethrow', error };
}

function describeWarnings(warnings: readonly unknown[] | undefined): string[] {
  return (warnings ?? []).map((warning) => JSON.stringify(warning));
}

export function createAiSdkLlmClient({ modelFor, log, now }: AiSdkLlmClientDeps): LlmClient {
  return {
    async generateObject<T>(request: LlmObjectRequest<T>): Promise<T> {
      const model = modelFor(request.role);
      const entry = (attempt: number, started: number) => ({
        stage: request.stage,
        role: request.role,
        model: model.modelId,
        attempt,
        latencyMs: now() - started,
      });

      for (let attempt = 1; ; attempt++) {
        const started = now();
        let usage: { inputTokens: number | undefined; outputTokens: number | undefined } = {
          inputTokens: undefined,
          outputTokens: undefined,
        };
        let warnings: string[] = [];
        try {
          const result = await generateText({
            model,
            system: request.system,
            prompt: request.prompt,
            output: Output.object({ schema: request.schema }),
            maxOutputTokens: request.maxOutputTokens,
            maxRetries: 0,
            providerOptions: {
              anthropic: {
                structuredOutputMode: 'outputFormat',
                effort: request.effort,
              } satisfies AnthropicLanguageModelOptions,
            },
          });
          usage = {
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
          };
          warnings = describeWarnings(result.warnings);

          // Reading `output` after a refusal throws, so check the finish reason first (ADR 0001 Q5).
          if (result.finishReason === 'content-filter') {
            log({ ...entry(attempt, started), ...usage, warnings, outcome: 'refusal' });
            throw new LlmError('LLM_REFUSAL', 'The model declined to answer this request.');
          }
          // `Output.object` already validated against this schema, so this is a defensive second
          // check (§7 "LLM output is untrusted input"): it guards against an SDK change.
          const parsed = request.schema.safeParse(result.output);
          if (!parsed.success) throw new OutputInvalidError({ cause: parsed.error });

          log({ ...entry(attempt, started), ...usage, warnings, outcome: 'ok' });
          return parsed.data;
        } catch (error) {
          if (error instanceof LlmError) throw error;
          // Unusable output was still billed; log its tokens so retries show their cost (§8.3).
          if (NoObjectGeneratedError.isInstance(error) && error.usage !== undefined) {
            usage = {
              inputTokens: error.usage.inputTokens,
              outputTokens: error.usage.outputTokens,
            };
          }
          const failure = classify(error);
          const retry = failure.kind === 'retryable' && attempt < MAX_ATTEMPTS;
          log({
            ...entry(attempt, started),
            ...usage,
            warnings,
            outcome: retry ? 'retry' : 'error',
            error: failure.error instanceof Error ? failure.error.name : typeof failure.error,
          });
          if (retry) continue;
          if (failure.kind === 'rethrow') throw failure.error;
          throw new LlmError('LLM_UPSTREAM_ERROR', 'The language model request failed.', {
            cause: failure.error,
          });
        }
      }
    },
  };
}

/** The default `log`: one console line per attempt (§8.3). */
export function consoleLlmLog(entry: LlmCallLog): void {
  const { warnings, ...rest } = entry;
  const fields = Object.entries(rest)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ');
  console.info(`[llm] ${fields}${warnings.length > 0 ? ` warnings=${warnings.join('; ')}` : ''}`);
}
