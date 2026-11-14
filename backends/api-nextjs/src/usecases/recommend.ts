// Stage 2, Recommend + critic (CLAUDE.md §7; WU-10 plan D1, D6 and approval changes 2–4). A ready
// profile → drafts → deterministic checks and the LLM critic → at most MAX_REVISIONS revisions →
// the passing attempt, or the one with the fewest issues → ids, labels and discards in code.
import { evaluateRules, type Discarded } from '@vp/domain-schema/rules';
import {
  RecommendationSet,
  type CritiqueIssue,
  type RecommendationDraft,
  type RecommendRequest,
  type RecommendResponse,
} from '@vp/domain-schema/wire';
import { z } from 'zod';
import { runDeterministicChecks } from './critic/checks.ts';
import { critiqueDrafts } from './critic/llm-critic.ts';
import { LlmError, ProfileNotReadyError } from './errors.ts';
import type { LlmClient } from './llm-client.ts';
import {
  buildRecommendPrompt,
  type RecommendPromptInput,
  type Revision,
} from './prompts/recommend.ts';
import { toWireRecommendations, toWireUnresolved } from './recommend-output.ts';
import { resolveOrigin, type RouteData } from './routes.ts';
import { RECOMMEND_MAX_OUTPUT_TOKENS } from './token-budget.ts';
import { tripStart } from './trip-month.ts';

/** Revisions after the first draft (§7: max 2 revise cycles, never unbounded). */
export const MAX_REVISIONS = 2;

export interface RecommendDeps {
  llm: LlmClient;
  routes: RouteData;
  /** A security signal (ADR 0004): path, reason, cap and size only, never the value. */
  logDiscarded: (discarded: Discarded) => void;
}

/** One draft and every issue found on it, deterministic first. */
export interface Attempt {
  drafts: RecommendationDraft[];
  issues: CritiqueIssue[];
}

// An empty list can't be repaired by a critic: it's invalid output, retried once, then a 502.
const AcceptDrafts = z.object({ recommendations: z.array(z.unknown()).min(1) });

/** Fewest issues wins; a tie goes to the later attempt, which saw more feedback (plan D6). */
export function pickBest(attempts: readonly Attempt[]): Attempt {
  const [first, ...rest] = attempts;
  if (first === undefined) throw new Error('pickBest needs at least one attempt');
  return rest.reduce(
    (best, next) => (next.issues.length <= best.issues.length ? next : best),
    first,
  );
}

export async function recommendTrip(
  request: RecommendRequest,
  { llm, routes, logDiscarded }: RecommendDeps,
): Promise<RecommendResponse> {
  const { profile, referenceDate } = request;
  const violations = evaluateRules(profile, referenceDate);
  if (violations.length > 0) throw new ProfileNotReadyError(violations.map((v) => v.code));

  const start = tripStart(profile, referenceDate);
  const origin = resolveOrigin(routes, profile.departure?.city);
  const base: RecommendPromptInput = {
    profile,
    referenceDate,
    tripStart: start,
    routes: origin ? { origin: origin.airport, nonstop: origin.nonstop } : null,
  };

  const attempts: Attempt[] = [];
  let revision: Revision | undefined;
  for (let cycle = 0; cycle <= MAX_REVISIONS; cycle += 1) {
    const { system, prompt } = buildRecommendPrompt(revision ? { ...base, revision } : base);
    const { recommendations: drafts } = await llm.generateObject({
      stage: 'recommend',
      role: 'reasoning',
      schema: RecommendationSet,
      accept: AcceptDrafts,
      system,
      prompt,
      maxOutputTokens: RECOMMEND_MAX_OUTPUT_TOKENS,
      effort: 'medium',
    });

    const found = runDeterministicChecks(drafts, profile, referenceDate, routes).map(
      ({ recommendationId, issue }) => ({ recommendationId, issue }),
    );
    const reviewed = await critiqueDrafts(
      { profile, referenceDate, tripStart: start, drafts, alreadyFound: found },
      llm,
      logDiscarded,
    );
    const attempt = { drafts, issues: [...found, ...reviewed] };
    attempts.push(attempt);
    if (attempt.issues.length === 0) break;
    revision = { previous: drafts, issues: attempt.issues };
  }

  const best = pickBest(attempts);
  const output = toWireRecommendations(best.drafts, profile, routes);
  output.discarded.forEach((entry) => logDiscarded(entry));
  if (output.recommendations.length === 0) {
    throw new LlmError('LLM_UPSTREAM_ERROR', 'No recommendation survived the output caps');
  }
  const kept = new Set(output.recommendations.map((r) => r.id));
  const { unresolved, discarded } = toWireUnresolved(best.issues, kept);
  discarded.forEach((entry) => logDiscarded(entry));
  return {
    recommendations: output.recommendations,
    critique: { pass: best.issues.length === 0, unresolved },
  };
}
