// NON-PRODUCTION SPIKE (WU-03). See ../README.md.
//
// Q5: what do a refusal, a schema-invalid response, non-JSON text and HTTP errors look like to
//     our code? Q6: is the custom fetch actually used (and how often, given SDK retries)?
// Fully offline: every response is synthetic.
import { createAnthropic } from '@ai-sdk/anthropic';
import {
  APICallError,
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
} from 'ai';
import { anthropicMessage, printFindings, syntheticFetch } from './capture-fetch.ts';
import { ExtractionProbe } from './schemas.ts';

const MODEL = 'claude-haiku-5-5';

const VALID = {
  departureCity: 'MSP',
  dateRange: null,
  region: null,
  climate: 'warm',
  experiences: ['beach'],
  unmappedExperiences: null,
  people: null,
};

function describeError(e: unknown) {
  if (!(e instanceof Error)) return { thrown: String(e) };
  const base: Record<string, unknown> = {
    name: e.name,
    constructor: e.constructor.name,
    message: e.message.slice(0, 300),
    isNoObjectGenerated: NoObjectGeneratedError.isInstance(e),
    isNoOutputGenerated: NoOutputGeneratedError.isInstance(e),
    isAPICallError: APICallError.isInstance(e),
  };
  if (NoObjectGeneratedError.isInstance(e)) {
    base.finishReason = e.finishReason;
    base.text = e.text;
    base.causeName = e.cause instanceof Error ? e.cause.name : undefined;
    base.causeMessage = e.cause instanceof Error ? e.cause.message.slice(0, 300) : undefined;
  }
  if (APICallError.isInstance(e)) {
    base.statusCode = e.statusCode;
    base.isRetryable = e.isRetryable;
  }
  // RetryError wraps the last APICallError.
  const withErrors = e as Error & { errors?: unknown[]; lastError?: unknown; reason?: unknown };
  if (withErrors.lastError !== undefined) {
    base.reason = withErrors.reason;
    base.lastError = describeError(withErrors.lastError);
  }
  return base;
}

async function scenario(label: string, body: unknown, status = 200, maxRetries?: number) {
  const { fetch, calls } = syntheticFetch(`q5-${label}`, body, status);
  const anthropic = createAnthropic({ apiKey: 'sk-synthetic-not-a-key', fetch });
  const out: Record<string, unknown> = { scenario: label };
  try {
    const result = await generateText({
      model: anthropic(MODEL),
      output: Output.object({ schema: ExtractionProbe }),
      prompt: 'synthetic',
      ...(maxRetries !== undefined && { maxRetries }),
    });
    out.finishReason = result.finishReason;
    out.rawFinishReason = result.rawFinishReason;
    out.providerMetadata = result.providerMetadata;
    try {
      out.output = result.output;
    } catch (e) {
      out.outputAccessError = describeError(e);
    }
  } catch (e) {
    out.generateTextRejected = describeError(e);
  }
  out.fetchCalls = calls.length; // Q6: proves the custom fetch is the transport, and counts retries
  return out;
}

const findings = [
  await scenario('valid', anthropicMessage({ model: MODEL, text: JSON.stringify(VALID), stopReason: 'end_turn' })),
  await scenario(
    'refusal-with-details',
    anthropicMessage({
      model: MODEL,
      stopReason: 'refusal',
      stopDetails: { type: 'refusal', category: 'cyber', explanation: 'synthetic' },
    }),
  ),
  await scenario('refusal-no-details', anthropicMessage({ model: MODEL, stopReason: 'refusal' })),
  await scenario(
    'schema-invalid-month-13',
    anthropicMessage({
      model: MODEL,
      text: JSON.stringify({
        ...VALID,
        dateRange: { kind: 'flexible', month: 13, year: 2027, durationNights: null, note: null },
      }),
      stopReason: 'end_turn',
    }),
  ),
  await scenario(
    'schema-invalid-missing-field',
    anthropicMessage({ model: MODEL, text: JSON.stringify({ departureCity: 'MSP' }), stopReason: 'end_turn' }),
  ),
  await scenario(
    'not-json',
    anthropicMessage({ model: MODEL, text: 'Sure! Here is your trip:', stopReason: 'end_turn' }),
  ),
  await scenario(
    'truncated-max-tokens',
    anthropicMessage({ model: MODEL, text: '{"departureCity":"MS', stopReason: 'max_tokens' }),
  ),
  await scenario('http-400', { type: 'error', error: { type: 'invalid_request_error', message: 'synthetic 400' } }, 400),
  await scenario('http-529-default-retries', { type: 'error', error: { type: 'overloaded_error', message: 'synthetic' } }, 529),
  await scenario('http-529-maxRetries-0', { type: 'error', error: { type: 'overloaded_error', message: 'synthetic' } }, 529, 0),
];

printFindings('Q5/Q6 failure modes (synthetic)', findings);
