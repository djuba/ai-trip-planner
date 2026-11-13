// Runs eval cases through the real extract use case and scores them (WU-18 plan D1–D3, D5, D6, D8).
// No clock, no environment and no file system here: run.ts supplies them, so this is unit-tested
// with a mock LlmClient. Calls run one at a time (rate limits, and a low-memory dev machine).
import {
  ExtractRequest,
  RuleViolation,
  TripProfile,
  type ExtractResponse,
} from '@vp/domain-schema/wire';
import type { Discarded } from '@vp/domain-schema/rules';
import { LlmError } from '../src/usecases/errors.ts';
import { extractTrip } from '../src/usecases/extract.ts';
import type { LlmClient } from '../src/usecases/llm-client.ts';
import {
  buildClarificationPrompt,
  CLARIFICATION_SYSTEM,
} from '../src/usecases/prompts/clarification.ts';
import { buildExtractionPrompt, EXTRACTION_SYSTEM } from '../src/usecases/prompts/extraction.ts';
import {
  CLARIFY_MAX_OUTPUT_TOKENS,
  EXTRACT_MAX_OUTPUT_TOKENS,
} from '../src/usecases/token-budget.ts';
import type { EvalCase } from './cases.ts';
import { costOf, estimateInputTokens, worstCaseUsd, type Pricing } from './cost.ts';
import {
  buildJudgePrompt,
  JUDGE_MAX_OUTPUT_TOKENS,
  JUDGE_SYSTEM,
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
  models: { fast: string; critic: string };
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

/** Every system prompt the model sees, for the leak scorer. */
export const SYSTEM_PROMPTS = [EXTRACTION_SYSTEM, CLARIFICATION_SYSTEM, JUDGE_SYSTEM] as const;

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
  ];
}

const ATTEMPTS = 2; // the first, plus the one retry (CLAUDE.md §7)

/**
 * The most one run of `evalCase` can cost: extraction and clarification each retried, at their
 * `maxOutputTokens`, with the clarification and judge inputs as large as a full extraction output.
 */
export function worstCaseRunUsd(
  evalCase: EvalCase,
  judge: boolean,
  { pricing, models }: Pick<RunnerDeps, 'pricing' | 'models'>,
): number {
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
): Promise<CaseObservation> {
  const attempts: Attempt[] = [];
  const discarded: Discarded[] = [];
  const observed = observeLlm(llm, (attempt) => attempts.push(attempt));
  let outcome: Outcome;
  try {
    const response: ExtractResponse = await extractTrip(evalCase.request, {
      llm: observed,
      logDiscarded: (entry) => discarded.push(entry),
    });
    outcome = { kind: 'response', response };
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
  const context: ScoreContext = { systemPrompts: SYSTEM_PROMPTS };
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
      const observation = await observeCase(evalCase, run, deps.llm);
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
