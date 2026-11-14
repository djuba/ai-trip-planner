// Runs eval cases through the real extract use case and scores them (WU-18 plan D1–D3, D5, D6, D8).
// No clock, no environment and no file system here: run.ts supplies them, so this is unit-tested
// with a mock LlmClient. Calls run one at a time (rate limits, and a low-memory dev machine).
import {
  ExtractRequest,
  RecommendationDraft,
  RuleViolation,
  TripProfile,
  type ExtractResponse,
} from '@vp/domain-schema/wire';
import type { Discarded } from '@vp/domain-schema/rules';
import { LlmError } from '../src/usecases/errors.ts';
import { extractTrip } from '../src/usecases/extract.ts';
import type { LlmClient } from '../src/usecases/llm-client.ts';
import { buildCriticPrompt, CRITIC_SYSTEM } from '../src/usecases/prompts/critic.ts';
import { buildRecommendPrompt, RECOMMEND_SYSTEM } from '../src/usecases/prompts/recommend.ts';
import { recommendTrip } from '../src/usecases/recommend.ts';
import { resolveOrigin, type RouteData } from '../src/usecases/routes.ts';
import { tripStart } from '../src/usecases/trip-month.ts';
import {
  buildClarificationPrompt,
  CLARIFICATION_SYSTEM,
} from '../src/usecases/prompts/clarification.ts';
import { buildExtractionPrompt, EXTRACTION_SYSTEM } from '../src/usecases/prompts/extraction.ts';
import {
  CLARIFY_MAX_OUTPUT_TOKENS,
  CRITIC_MAX_OUTPUT_TOKENS,
  EXTRACT_MAX_OUTPUT_TOKENS,
  RECOMMEND_MAX_OUTPUT_TOKENS,
} from '../src/usecases/token-budget.ts';
import type { EvalCase } from './cases.ts';
import { costOf, estimateInputTokens, worstCaseUsd, type Pricing } from './cost.ts';
import {
  buildJudgePrompt,
  buildRecommendJudgePrompt,
  JUDGE_MAX_OUTPUT_TOKENS,
  JUDGE_SYSTEM,
  RECOMMEND_JUDGE_SYSTEM,
  judgeCase,
  type JudgeOutcome,
} from './judge.ts';
import { observeLlm } from './observe.ts';
import type { EvalPlan } from './plan.ts';
import { scoreDeterministic } from './scorers.ts';
import type { Attempt, CaseObservation, Outcome, ScoreContext, ScoreResult } from './types.ts';

/** One attempt's usage, as `createLlmClient`'s `log` reports it. */
export interface CallUsage {
  model: string;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
}

export interface RunnerDeps {
  llm: LlmClient;
  /** Filled by the client's `log` as calls happen; the runner reads it to track spend. */
  calls: readonly CallUsage[];
  pricing: Pricing;
  models: { fast: string; reasoning: string; critic: string };
  /** The route data the recommend cases run with (parsed from data/routes.json by run.ts). */
  routes: RouteData;
  /** One line per case run. */
  progress?: (line: string) => void;
}

export interface ScoredRun {
  observation: CaseObservation;
  results: ScoreResult[];
  judge?: JudgeOutcome;
}

export interface EvalRun {
  runs: ScoredRun[];
  stoppedAtBudget: boolean;
  costUsd: number;
}

export class CaseSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaseSelectionError';
  }
}

/** The cases a plan selects: its sets, then its ids if any. An unknown id is an error. */
export function selectCases(
  cases: readonly EvalCase[],
  plan: Pick<EvalPlan, 'sets' | 'caseIds'>,
): EvalCase[] {
  const known = new Set(cases.map((c) => c.id));
  const unknown = plan.caseIds.filter((id) => !known.has(id));
  if (unknown.length > 0) throw new CaseSelectionError(`unknown case: ${unknown.join(', ')}`);
  const selected = cases.filter(
    (c) => plan.sets.includes(c.set) && (plan.caseIds.length === 0 || plan.caseIds.includes(c.id)),
  );
  if (selected.length === 0) throw new CaseSelectionError('no case matches the selection');
  return selected;
}

// Fixed probe values, parsed so they stay wire-valid (CLAUDE.md §6.1).
const PROBE_REQUEST = ExtractRequest.parse({
  message: 'probe',
  currentProfile: { region: 'probe' },
  referenceDate: '2030-01-15',
});
const PROBE_VIOLATIONS = [
  RuleViolation.parse({
    code: 'INSUFFICIENT_DETAIL',
    path: '',
    params: { populated: 1, required: 3 },
  }),
];
const PROBE_PROFILE = TripProfile.parse({ region: 'probe' });
const PROBE_DRAFT = RecommendationDraft.parse({
  destination: 'probe',
  summary: 'probe',
  matchedExperiences: [],
  bestMonths: [],
  adultsOnly: false,
  claims: [],
});

/** Every system prompt the model sees, for the leak scorer. */
export const SYSTEM_PROMPTS = [
  EXTRACTION_SYSTEM,
  CLARIFICATION_SYSTEM,
  JUDGE_SYSTEM,
  RECOMMEND_SYSTEM,
  CRITIC_SYSTEM,
  RECOMMEND_JUDGE_SYSTEM,
] as const;

/**
 * What the prompt hash covers (plan D7): every system prompt, plus one probe user message from each
 * builder, so a template change shows as well as a system prompt change.
 */
export function promptHashParts(): string[] {
  return [
    ...SYSTEM_PROMPTS,
    buildExtractionPrompt(PROBE_REQUEST).prompt,
    buildClarificationPrompt(PROBE_VIOLATIONS, PROBE_PROFILE).prompt,
    buildJudgePrompt({
      fields: [{ path: '/region', purpose: 'probe', value: 'probe' }],
      question: 'probe?',
    }).prompt,
    buildRecommendPrompt({
      profile: PROBE_PROFILE,
      referenceDate: '2030-01-15',
      tripStart: null,
      routes: null,
    }).prompt,
    buildCriticPrompt({
      profile: PROBE_PROFILE,
      referenceDate: '2030-01-15',
      tripStart: null,
      drafts: [PROBE_DRAFT],
      alreadyFound: [],
    }).prompt,
    buildRecommendJudgePrompt({ profile: PROBE_PROFILE, recommendations: [] }).prompt,
  ];
}

const ATTEMPTS = 2; // the first, plus the one retry (CLAUDE.md §7)

/** Most recommend calls in one run: the first draft plus MAX_REVISIONS revisions, each critiqued. */
const RECOMMEND_CYCLES = 3; // 1 + MAX_REVISIONS (src/usecases/recommend.ts)

/**
 * The most a recommend case can cost: 3 recommend and 3 critic calls, each retried (12 calls), at
 * their `maxOutputTokens`. A revision's input holds the previous drafts and issues, and a critic's
 * input holds the drafts, so both are sized as a full recommend output plus a full critic output.
 */
function worstCaseRecommendUsd(
  evalCase: Extract<EvalCase, { set: 'recommend' }>,
  judge: boolean,
  { pricing, models, routes }: Pick<RunnerDeps, 'pricing' | 'models'> & { routes?: RouteData },
): number {
  const { profile, referenceDate } = evalCase.request;
  const origin = routes === undefined ? null : resolveOrigin(routes, profile.departure?.city);
  const first = buildRecommendPrompt({
    profile,
    referenceDate,
    tripStart: tripStart(profile, referenceDate),
    routes: origin ? { origin: origin.airport, nonstop: origin.nonstop } : null,
  });
  const revisionInput = RECOMMEND_MAX_OUTPUT_TOKENS + CRITIC_MAX_OUTPUT_TOKENS;
  const recommendInput = estimateInputTokens(first.system + first.prompt) + revisionInput;
  const criticInput = estimateInputTokens(CRITIC_SYSTEM + JSON.stringify(profile)) + revisionInput;
  const call = (model: string, inputTokens: number, maxOutputTokens: number) =>
    Array.from({ length: RECOMMEND_CYCLES * ATTEMPTS }, () => ({
      model,
      inputTokens,
      maxOutputTokens,
    }));
  return worstCaseUsd(
    [
      ...call(models.reasoning, recommendInput, RECOMMEND_MAX_OUTPUT_TOKENS),
      ...call(models.critic, criticInput, CRITIC_MAX_OUTPUT_TOKENS),
      ...(judge
        ? Array.from({ length: ATTEMPTS }, () => ({
            model: models.critic,
            inputTokens:
              estimateInputTokens(RECOMMEND_JUDGE_SYSTEM + JSON.stringify(profile)) +
              RECOMMEND_MAX_OUTPUT_TOKENS,
            maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS,
          }))
        : []),
    ],
    pricing,
  );
}

/**
 * The most one run of `evalCase` can cost: extraction and clarification each retried, at their
 * `maxOutputTokens`, with the clarification and judge inputs as large as a full extraction output.
 * `routes` only sizes a recommend case's prompt.
 */
export function worstCaseRunUsd(
  evalCase: EvalCase,
  judge: boolean,
  deps: Pick<RunnerDeps, 'pricing' | 'models'> & { routes?: RouteData },
): number {
  if (evalCase.set === 'recommend') return worstCaseRecommendUsd(evalCase, judge, deps);
  const { pricing, models } = deps;
  const extractPrompt = buildExtractionPrompt(evalCase.request);
  const call = (model: string, inputTokens: number, maxOutputTokens: number) =>
    Array.from({ length: ATTEMPTS }, () => ({ model, inputTokens, maxOutputTokens }));
  return worstCaseUsd(
    [
      ...call(
        models.fast,
        estimateInputTokens(extractPrompt.system + extractPrompt.prompt),
        EXTRACT_MAX_OUTPUT_TOKENS,
      ),
      ...call(
        models.fast,
        estimateInputTokens(CLARIFICATION_SYSTEM) + EXTRACT_MAX_OUTPUT_TOKENS,
        CLARIFY_MAX_OUTPUT_TOKENS,
      ),
      ...(judge
        ? call(
            models.critic,
            estimateInputTokens(JUDGE_SYSTEM) +
              EXTRACT_MAX_OUTPUT_TOKENS +
              CLARIFY_MAX_OUTPUT_TOKENS,
            JUDGE_MAX_OUTPUT_TOKENS,
          )
        : []),
    ],
    pricing,
  );
}

async function observeCase(
  evalCase: EvalCase,
  run: number,
  llm: LlmClient,
  routes: RouteData,
): Promise<CaseObservation> {
  const attempts: Attempt[] = [];
  const discarded: Discarded[] = [];
  const observed = observeLlm(llm, (attempt) => attempts.push(attempt));
  let outcome: Outcome;
  try {
    const logDiscarded = (entry: Discarded) => discarded.push(entry);
    if (evalCase.set === 'recommend') {
      const response = await recommendTrip(evalCase.request, {
        llm: observed,
        routes,
        logDiscarded,
      });
      outcome = { kind: 'recommendation', response };
    } else {
      const response: ExtractResponse = await extractTrip(evalCase.request, {
        llm: observed,
        logDiscarded,
      });
      outcome = { kind: 'response', response };
    }
  } catch (error) {
    outcome =
      error instanceof LlmError
        ? { kind: 'llm-error', code: error.code }
        : {
            kind: 'error',
            name: error instanceof Error ? error.name : typeof error,
            message: error instanceof Error ? error.message : String(error),
          };
  }
  return { evalCase, run, attempts, discarded, outcome };
}

async function judged(observation: CaseObservation, llm: LlmClient): Promise<JudgeOutcome> {
  try {
    return await judgeCase(observation, llm);
  } catch (error) {
    // A bug in the judge must not throw away a paid run; it is recorded, never scored as a pass.
    return {
      kind: 'not-judged',
      reason: `error: ${error instanceof Error ? error.name : 'unknown'}`,
    };
  }
}

function describe(results: readonly ScoreResult[], judge: JudgeOutcome | undefined): string {
  const failed = results.filter((r) => !r.pass).map((r) => r.scorer);
  const verdict = failed.length === 0 ? 'pass' : `FAIL ${failed.join(', ')}`;
  return judge?.kind === 'not-judged' ? `${verdict} (not judged: ${judge.reason})` : verdict;
}

export async function runEval(
  cases: readonly EvalCase[],
  plan: Pick<EvalPlan, 'budgetUsd' | 'repeat' | 'judge'>,
  deps: RunnerDeps,
): Promise<EvalRun> {
  const context: ScoreContext = { systemPrompts: SYSTEM_PROMPTS, routes: deps.routes };
  const spent = () => costOf(deps.calls, deps.pricing);
  const runs: ScoredRun[] = [];
  let stoppedAtBudget = false;

  outer: for (const evalCase of cases) {
    for (let run = 1; run <= plan.repeat; run += 1) {
      if (spent() + worstCaseRunUsd(evalCase, plan.judge, deps) > plan.budgetUsd) {
        stoppedAtBudget = true;
        deps.progress?.(`budget: stopping before ${evalCase.set}/${evalCase.id} run ${run}`);
        break outer;
      }
      const observation = await observeCase(evalCase, run, deps.llm, deps.routes);
      const results = scoreDeterministic(observation, context);
      let judge: JudgeOutcome | undefined;
      if (plan.judge) {
        judge = await judged(observation, deps.llm);
        if (judge.kind === 'judged') results.push(...judge.results);
      }
      runs.push({ observation, results, ...(judge ? { judge } : {}) });
      deps.progress?.(
        `${evalCase.set}/${evalCase.id} run ${run}/${plan.repeat}: ${describe(results, judge)}`,
      );
    }
  }
  return { runs, stoppedAtBudget, costUsd: spent() };
}
