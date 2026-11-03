// NON-PRODUCTION SPIKE (WU-03). See ../README.md.
//
// Q1: which API produces structured output in the pinned versions?  -> generateText + Output.object
// Q2: native structured output (no forced tool_choice) on Sonnet 5.5 and Haiku 5.5?
// Q3: does the required-but-nullable ExtractionProbe round-trip?
// Q4: how is `effort` sent; are sampling params ever sent?
//
// Phase A is offline (synthetic fetch): inspect the exact request body per model x setting.
// Phase B is live (2 calls): run the extraction probe on each model.
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, Output } from 'ai';
import { anthropicMessage, captureFetch, printFindings, syntheticFetch } from './capture-fetch.ts';
import { ExtractionProbe } from './schemas.ts';

const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5'] as const;

// Byte-stable system prompt (§8.3): no dates, no per-request content.
const SYSTEM =
  'You extract a vacation request into the given JSON schema. Use null for anything the user did ' +
  'not mention. Only use experience values from the enum; put anything else the user asked for ' +
  'into unmappedExperiences. Resolve relative dates against referenceDate.';

const USER = JSON.stringify({
  referenceDate: '2026-10-27',
  currentProfile: null,
  message:
    'Two adults and our 7 year old want somewhere warm next March for about a week, flying out of ' +
    'Minneapolis. We love beaches and snorkeling, and my wife wants to do a wine tasting.',
});

type Settings = { label: string; providerOptions?: Record<string, unknown>; temperature?: number };
const SETTINGS: Settings[] = [
  { label: 'defaults' },
  { label: 'effort-low', providerOptions: { anthropic: { effort: 'low' } } },
  { label: 'temperature-0.5-passed', temperature: 0.5 },
  { label: 'jsonTool-mode', providerOptions: { anthropic: { structuredOutputMode: 'jsonTool' } } },
];

function summarizeRequest(body: Record<string, unknown>) {
  const outputConfig = body.output_config as { format?: { type?: string; schema?: unknown }; effort?: string } | undefined;
  return {
    keys: Object.keys(body).sort(),
    max_tokens: body.max_tokens,
    output_config_format_type: outputConfig?.format?.type,
    output_config_effort: outputConfig?.effort,
    tools: (body.tools as { name: string }[] | undefined)?.map((t) => t.name),
    tool_choice: body.tool_choice,
    temperature: body.temperature,
    top_p: body.top_p,
    top_k: body.top_k,
    thinking: body.thinking,
  };
}

// ---- Phase A: offline request shapes ---------------------------------------------------------
const phaseA: unknown[] = [];
for (const model of MODELS) {
  for (const s of SETTINGS) {
    const label = `q2-request-${model}-${s.label}`;
    const { fetch, calls } = syntheticFetch(
      label,
      anthropicMessage({ model, text: '{}', stopReason: 'end_turn' }),
    );
    const anthropic = createAnthropic({ apiKey: 'sk-synthetic-not-a-key', fetch });
    let warnings: unknown;
    try {
      const r = await generateText({
        model: anthropic(model),
        system: SYSTEM,
        prompt: USER,
        output: Output.object({ schema: ExtractionProbe }),
        maxRetries: 0,
        ...(s.temperature !== undefined && { temperature: s.temperature }),
        ...(s.providerOptions && { providerOptions: s.providerOptions as never }),
      });
      warnings = r.warnings;
    } catch (e) {
      // '{}' fails the schema; we only want the request and the warnings.
      warnings = (e as { response?: unknown }).response ? 'see error' : String(e).slice(0, 120);
    }
    const sent = calls[0]?.request;
    phaseA.push({
      model,
      setting: s.label,
      anthropicBeta: sent?.headers['anthropic-beta'],
      request: summarizeRequest((sent?.body ?? {}) as Record<string, unknown>),
      warnings,
    });
  }
}
printFindings('Q2/Q4 request shapes (offline)', phaseA);

// ---- Phase B: live round-trip ------------------------------------------------------------------
if (!process.env.ANTHROPIC_API_KEY) {
  console.log('\nPhase B skipped: ANTHROPIC_API_KEY not set');
} else {
  const phaseB: unknown[] = [];
  for (const model of MODELS) {
    const { fetch } = captureFetch(`q3-live-extract-${model}`);
    const anthropic = createAnthropic({ fetch });
    const started = performance.now();
    try {
      const r = await generateText({
        model: anthropic(model),
        system: SYSTEM,
        prompt: USER,
        output: Output.object({ schema: ExtractionProbe }),
        providerOptions: { anthropic: { effort: 'low' } },
        maxOutputTokens: 4000,
        maxRetries: 0,
      });
      phaseB.push({
        model,
        latencyMs: Math.round(performance.now() - started),
        finishReason: r.finishReason,
        usage: r.usage,
        warnings: r.warnings,
        output: r.output,
        safeParse: ExtractionProbe.safeParse(r.output).success,
        responseModel: r.response.modelId,
      });
    } catch (e) {
      phaseB.push({ model, error: (e as Error).name, message: (e as Error).message.slice(0, 500) });
    }
  }
  printFindings('Q1/Q3 live extraction', phaseB);
}
