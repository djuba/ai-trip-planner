// Writes `clarificationQuestion` from the violations (CLAUDE.md §7 stage 1, the second fast call).
// The wire caps the question (ADR 0004); the model's schema can't say so (ADR 0001 Q3), so the cap
// goes in `accept`, and an empty or over-cap reply is invalid output: retried once, then a 502.
import {
  ClarificationOutput,
  codePointLength,
  MAX_CLARIFICATION_QUESTION_LENGTH,
  type RuleViolation,
  type TripProfile,
} from '@vp/domain-schema/wire';
import { z } from 'zod';
import type { LlmClient } from './llm-client.ts';
import { buildClarificationPrompt } from './prompts/clarification.ts';
import { CLARIFY_MAX_OUTPUT_TOKENS } from './token-budget.ts';

/** Whether a question, once trimmed, is something the wire can carry. */
export function isUsableQuestion(question: string): boolean {
  const trimmed = question.trim();
  return trimmed !== '' && codePointLength(trimmed) <= MAX_CLARIFICATION_QUESTION_LENGTH;
}

const AcceptQuestion = z.object({
  question: z.string().refine(isUsableQuestion, {
    message: `must be non-blank and at most ${MAX_CLARIFICATION_QUESTION_LENGTH} code points`,
  }),
});

export async function writeClarificationQuestion(
  violations: readonly RuleViolation[],
  profile: TripProfile,
  llm: LlmClient,
): Promise<string> {
  const { system, prompt } = buildClarificationPrompt(violations, profile);
  const { question } = await llm.generateObject({
    stage: 'clarify',
    role: 'fast',
    schema: ClarificationOutput,
    accept: AcceptQuestion,
    system,
    prompt,
    maxOutputTokens: CLARIFY_MAX_OUTPUT_TOKENS,
    effort: 'low',
  });
  return question.trim();
}
