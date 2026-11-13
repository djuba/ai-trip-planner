// Stage 1, Extract (CLAUDE.md §7): message + current profile → ExtractionSchema → normalize →
// rules → `ready`, or `needs_clarification` with a question written from the violation codes.
// The server is stateless (§5): the model returns the full updated profile, not a patch.
import {
  ExtractionSchema,
  type ExtractRequest,
  type ExtractResponse,
} from '@vp/domain-schema/wire';
import { evaluateRules, normalize, type Discarded } from '@vp/domain-schema/rules';
import { writeClarificationQuestion } from './clarify.ts';
import type { LlmClient } from './llm-client.ts';
import { buildExtractionPrompt } from './prompts/extraction.ts';
import { EXTRACT_MAX_OUTPUT_TOKENS } from './token-budget.ts';

export interface ExtractDeps {
  llm: LlmClient;
  /** A security signal (ADR 0004): path, reason, cap and length only, never the value. */
  logDiscarded: (discarded: Discarded) => void;
}

export async function extractTrip(
  request: ExtractRequest,
  { llm, logDiscarded }: ExtractDeps,
): Promise<ExtractResponse> {
  const { system, prompt } = buildExtractionPrompt(request);
  const extraction = await llm.generateObject({
    stage: 'extract',
    role: 'fast',
    schema: ExtractionSchema,
    system,
    prompt,
    maxOutputTokens: EXTRACT_MAX_OUTPUT_TOKENS,
    effort: 'low',
  });

  const { profile, discarded } = normalize(extraction);
  discarded.forEach((entry) => logDiscarded(entry));

  const violations = evaluateRules(profile, request.referenceDate);
  if (violations.length === 0) return { status: 'ready', profile };

  const clarificationQuestion = await writeClarificationQuestion(violations, profile, llm);
  return { status: 'needs_clarification', profile, violations, clarificationQuestion };
}
