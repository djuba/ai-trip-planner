// NON-PRODUCTION SPIKE (WU-03). See ../README.md.
//
// Q3 (constructs): for each Zod construct, what does the provider send in
// output_config.format.schema (offline), and does the live API accept it (Haiku, 1 call each)?
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { anthropicMessage, captureFetch, printFindings, syntheticFetch } from './capture-fetch.ts';
import { CONSTRUCTS, type ConstructName } from './schemas.ts';

const MODEL = 'claude-haiku-5-5';
const live = Boolean(process.env.ANTHROPIC_API_KEY);
const findings: unknown[] = [];

for (const [name, schema] of Object.entries(CONSTRUCTS) as [ConstructName, z.ZodType][]) {
  // Offline: what Zod emits vs what the provider sends.
  const { fetch: synth, calls } = syntheticFetch(
    `q3-construct-${name}-request`,
    anthropicMessage({ model: MODEL, text: '{}', stopReason: 'end_turn' }),
  );
  await generateText({
    model: createAnthropic({ apiKey: 'sk-synthetic-not-a-key', fetch: synth })(MODEL),
    output: Output.object({ schema }),
    prompt: 'synthetic',
    maxRetries: 0,
  }).catch(() => undefined);
  const sentBody = calls[0]?.request.body as { output_config?: { format?: { schema?: unknown } } };
  const entry: Record<string, unknown> = {
    construct: name,
    zodJsonSchema: z.toJSONSchema(schema, { io: 'input' }),
    sentSchema: sentBody.output_config?.format?.schema,
  };

  if (live) {
    const { fetch } = captureFetch(`q3-construct-${name}-live`);
    try {
      const r = await generateText({
        model: createAnthropic({ fetch })(MODEL),
        output: Output.object({ schema }),
        prompt:
          'Return any small example object that fits the schema. For n use 7, for s use "MSP", ' +
          'for d use 2027-03-14.',
        providerOptions: { anthropic: { effort: 'low', structuredOutputMode: 'outputFormat' } },
        maxOutputTokens: 1000,
        maxRetries: 0,
      });
      entry.live = { accepted: true, output: r.output, usage: r.usage.totalTokens };
    } catch (e) {
      const err = e as Error & { statusCode?: number; responseBody?: string; text?: string };
      entry.live = {
        accepted: err.statusCode === undefined, // non-HTTP failure = API accepted, local validation failed
        error: err.name,
        statusCode: err.statusCode,
        message: (err.responseBody ?? err.message).slice(0, 400),
        modelText: err.text,
      };
    }
  }
  findings.push(entry);
}

printFindings(`Q3 constructs matrix (${live ? 'offline + live' : 'offline only'})`, findings);
