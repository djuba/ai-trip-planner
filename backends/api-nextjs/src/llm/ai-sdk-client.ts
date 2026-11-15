// The LlmClient over the AI SDK (CLAUDE.md §7, §8.2; ADR 0001 Decision; WU-08 plan D2, D3, D9;
// WU-11 plan D1). Every call: `generateText` or `streamText` + `Output.object`, native structured
// output, no SDK retries, an explicit token cap and `effort`, never sampling params. The refusal
// check comes before `output`, and the output is `safeParse`d again because model output is
// untrusted input.
import type { AnthropicLanguageModelOptions } from '@ai-sdk/anthropic';
import {
  APICallError,
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  parsePartialJson,
  streamText,
  type LanguageModel,
  type TextStreamPart,
  type ToolSet,
} from 'ai';
import { LlmError } from '../usecases/errors.ts';
import type {
  LlmClient,
  LlmObjectRequest,
  LlmStage,
  LlmStreamPart,
  ModelRole,
  PartialObject,
} from '../usecases/llm-client.ts';
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
  constructor(options?: ErrorOptions) {
    super('Model output was cut off at maxOutputTokens', options);
    this.name = 'OutputTruncatedError';
  }
}

/** A stream finished without output, or with a finish reason other than `stop`. */
class StreamEndedError extends Error {
  readonly finishReason: string;

  constructor(finishReason: string) {
    super(`The model stream ended early (finishReason: ${finishReason})`);
    this.name = 'StreamEndedError';
    this.finishReason = finishReason;
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
  if (error instanceof OutputTruncatedError) return { kind: 'final', error };
  if (NoObjectGeneratedError.isInstance(error) && error.finishReason === 'length') {
    return { kind: 'final', error: new OutputTruncatedError({ cause: error }) };
  }
  if (
    error instanceof OutputInvalidError ||
    error instanceof StreamEndedError ||
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

function providerOptionsFor(request: LlmObjectRequest<unknown>) {
  return {
    anthropic: {
      structuredOutputMode: 'outputFormat',
      effort: request.effort,
    } satisfies AnthropicLanguageModelOptions,
  };
}

type Usage = { inputTokens: number | undefined; outputTokens: number | undefined };
const NO_USAGE: Usage = { inputTokens: undefined, outputTokens: undefined };

/** What one streamed attempt yields: partial snapshots, then how it finished. */
type AttemptEvent =
  | { kind: 'partial'; value: Record<string, unknown> }
  | { kind: 'finish'; finishReason: string; text: string; usage: Usage };

/**
 * Reads one `streamText` attempt's `fullStream`, so `error` and `finish` parts are seen as well as
 * text (ADR 0001 Q1). Yields a snapshot each time the parsed partial object changes; an `error`
 * part is thrown. Returning early cancels the SDK stream, and with it the model call.
 */
async function* readAttempt(
  parts: AsyncIterable<TextStreamPart<ToolSet>>,
  onWarnings: (warnings: string[]) => void,
): AsyncGenerator<AttemptEvent, void, undefined> {
  let text = '';
  let last: string | undefined;
  for await (const part of parts) {
    if (part.type === 'start-step') {
      onWarnings(describeWarnings(part.warnings));
    } else if (part.type === 'text-delta') {
      text += part.text;
      const { value } = await parsePartialJson(text);
      if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
      const snapshot = JSON.stringify(value);
      if (snapshot === last) continue;
      last = snapshot;
      yield { kind: 'partial', value: value as Record<string, unknown> };
    } else if (part.type === 'error') {
      throw part.error;
    } else if (part.type === 'finish') {
      const { inputTokens, outputTokens } = part.totalUsage;
      yield {
        kind: 'finish',
        finishReason: part.finishReason,
        text,
        usage: { inputTokens, outputTokens },
      };
      return;
    }
  }
  // A stream that closed without a `finish` part did not complete.
  yield { kind: 'finish', finishReason: 'other', text, usage: NO_USAGE };
}

/** Parses a finished stream's text against `schema`, then `accept` (§7 "untrusted input"). */
function parseFinal<T>(request: LlmObjectRequest<T>, text: string): T {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new OutputInvalidError({ cause: error });
  }
  const parsed = request.schema.safeParse(json);
  if (!parsed.success) throw new OutputInvalidError({ cause: parsed.error });
  const accepted = request.accept?.safeParse(parsed.data);
  if (accepted?.success === false) throw new OutputInvalidError({ cause: accepted.error });
  return parsed.data;
}

/** A stream that ended other than with `stop`, as the error thrown after the first partial. */
function endError(finishReason: string): LlmError {
  if (finishReason === 'content-filter') {
    return new LlmError('LLM_REFUSAL', 'The model declined to answer this request.', {
      midStream: true,
    });
  }
  const cause =
    finishReason === 'length' ? new OutputTruncatedError() : new StreamEndedError(finishReason);
  return new LlmError('LLM_UPSTREAM_ERROR', 'The language model stream failed.', {
    cause,
    midStream: true,
  });
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
        let usage: Usage = NO_USAGE;
        let warnings: string[] = [];
        try {
          const result = await generateText({
            model,
            system: request.system,
            prompt: request.prompt,
            output: Output.object({ schema: request.schema }),
            maxOutputTokens: request.maxOutputTokens,
            maxRetries: 0,
            providerOptions: providerOptionsFor(request),
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
          // The caller's extra checks (LlmObjectRequest.accept) run only on schema-valid output.
          const accepted = request.accept?.safeParse(parsed.data);
          if (accepted?.success === false) throw new OutputInvalidError({ cause: accepted.error });

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

    async streamObject<T>(request: LlmObjectRequest<T>): Promise<AsyncIterable<LlmStreamPart<T>>> {
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
        let warnings: string[] = [];
        // `fullStream` is one branch of a tee, so stopping it alone doesn't stop the model call.
        const abort = new AbortController();
        const result = streamText({
          abortSignal: abort.signal,
          model,
          system: request.system,
          prompt: request.prompt,
          output: Output.object({ schema: request.schema }),
          maxOutputTokens: request.maxOutputTokens,
          maxRetries: 0,
          providerOptions: providerOptionsFor(request),
          // Failures are read from `fullStream`; this only stops the SDK's own console logging.
          onError: () => undefined,
        });
        const events = readAttempt(result.fullStream, (w) => (warnings = w));

        // Before the first partial nothing has been sent, so failures are handled as in
        // `generateObject`: one retry, then LlmError (a JSON 502).
        let first: Record<string, unknown>;
        let usage: Usage = NO_USAGE;
        try {
          const next = await events.next();
          if (next.done === true) throw new StreamEndedError('other');
          const event = next.value;
          if (event.kind === 'finish') {
            usage = event.usage;
            if (event.finishReason === 'content-filter') {
              log({ ...entry(attempt, started), ...usage, warnings, outcome: 'refusal' });
              throw new LlmError('LLM_REFUSAL', 'The model declined to answer this request.');
            }
            if (event.finishReason === 'length') throw new OutputTruncatedError();
            throw new StreamEndedError(event.finishReason);
          }
          first = event.value;
        } catch (error) {
          abort.abort();
          await events.return();
          if (error instanceof LlmError) throw error;
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

        // After it there is no retry: every failure is thrown from the iterator, mid-stream.
        const finish = (outcome: LlmCallLog['outcome'], error?: string) =>
          log({
            ...entry(attempt, started),
            ...usage,
            warnings,
            outcome,
            ...(error === undefined ? {} : { error }),
          });

        return (async function* (): AsyncGenerator<LlmStreamPart<T>, void, undefined> {
          let ended = false;
          try {
            yield { type: 'partial', partial: first as PartialObject<T> };
            for (;;) {
              let next: IteratorResult<AttemptEvent, void>;
              try {
                next = await events.next();
              } catch (error) {
                const miss = findCause(error, CassetteMissError);
                if (miss !== undefined) throw miss;
                throw new LlmError('LLM_UPSTREAM_ERROR', 'The language model stream failed.', {
                  cause: error,
                  midStream: true,
                });
              }
              if (next.done === true) throw endError('other');
              const event = next.value;
              if (event.kind === 'partial') {
                yield { type: 'partial', partial: event.value as PartialObject<T> };
                continue;
              }
              usage = event.usage;
              if (event.finishReason !== 'stop') throw endError(event.finishReason);
              let object: T;
              try {
                object = parseFinal(request, event.text);
              } catch (error) {
                throw new LlmError('LLM_UPSTREAM_ERROR', 'The model output was invalid.', {
                  cause: error,
                  midStream: true,
                });
              }
              ended = true;
              finish('ok');
              yield { type: 'final', object };
              return;
            }
          } catch (error) {
            ended = true;
            if (error instanceof LlmError && error.code === 'LLM_REFUSAL') finish('refusal');
            else {
              const cause = error instanceof LlmError ? error.cause : error;
              finish('error', cause instanceof Error ? cause.name : typeof cause);
            }
            throw error;
          } finally {
            // The consumer stopped early (a client disconnect): cancel the call.
            if (!ended) abort.abort();
            await events.return();
            if (!ended) finish('error', 'AbortError');
          }
        })();
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
