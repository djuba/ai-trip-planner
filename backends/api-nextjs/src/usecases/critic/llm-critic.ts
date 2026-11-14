// The LLM critic (CLAUDE.md §7 stage 2b; WU-10 plan D1, D8 and approval changes 2 and 8). It runs
// on every attempt, after the deterministic checks. Its `accept` checks only that `pass` agrees with
// `issues`; issue text that is blank or over the cap, or past the per-call limit, is discarded and
// logged, so a verbose critic never fails the whole request.
import type { Discarded } from '@vp/domain-schema/rules';
import {
  codePointLength,
  CritiqueResult,
  MAX_CRITIQUE_ISSUE_LENGTH,
  type CritiqueIssue,
  type RecommendationDraft,
  type TripProfile,
} from '@vp/domain-schema/wire';
import { z } from 'zod';
import type { LlmClient } from '../llm-client.ts';
import { buildCriticPrompt, MAX_CRITIC_ISSUES } from '../prompts/critic.ts';
import type { TripStart } from '../trip-month.ts';
import { recommendationId } from '../recommend-output.ts';
import { CRITIC_MAX_OUTPUT_TOKENS } from '../token-budget.ts';

const AcceptCritique = z
  .object({ pass: z.boolean(), issues: z.array(z.unknown()) })
  .refine((value) => value.pass === (value.issues.length === 0), {
    message: 'pass must be true exactly when issues is empty',
  });

/**
 * Stands in for a critic issue we can't show (blank or over the cap), so the attempt still counts
 * as failing and the revision knows which recommendation to look at. Fixed text, never model text.
 */
export const UNSHOWABLE_ISSUE = 'The reviewer raised an issue that could not be shown.';

export interface CriticInput {
  profile: TripProfile;
  referenceDate: string;
  tripStart: TripStart | null;
  drafts: readonly RecommendationDraft[];
  alreadyFound: readonly CritiqueIssue[];
}

export async function critiqueDrafts(
  input: CriticInput,
  llm: LlmClient,
  logDiscarded: (discarded: Discarded) => void,
): Promise<CritiqueIssue[]> {
  const { system, prompt } = buildCriticPrompt(input);
  const result = await llm.generateObject({
    stage: 'critic',
    role: 'critic',
    schema: CritiqueResult,
    accept: AcceptCritique,
    system,
    prompt,
    maxOutputTokens: CRITIC_MAX_OUTPUT_TOKENS,
    effort: 'medium',
  });

  const ids = new Set(input.drafts.map((_, index) => recommendationId(index)));
  if (result.issues.length > MAX_CRITIC_ISSUES) {
    logDiscarded({
      path: '/critique/issues',
      reason: 'too_many_items',
      limit: MAX_CRITIC_ISSUES,
      actual: result.issues.length,
    });
  }
  return result.issues.slice(0, MAX_CRITIC_ISSUES).map((raw, index) => {
    // An id the critic invented (or copied from the data) is not a recommendation we can point to.
    const id = raw.recommendationId?.trim() ?? null;
    const recommendationIdOrNull = id !== null && ids.has(id) ? id : null;
    const text = raw.issue.trim();
    const length = codePointLength(text);
    if (length === 0 || length > MAX_CRITIQUE_ISSUE_LENGTH) {
      logDiscarded({
        path: `/critique/issues/${index}/issue`,
        reason: 'too_long',
        limit: MAX_CRITIQUE_ISSUE_LENGTH,
        actual: length,
      });
      return { recommendationId: recommendationIdOrNull, issue: UNSHOWABLE_ISSUE };
    }
    return { recommendationId: recommendationIdOrNull, issue: text };
  });
}
