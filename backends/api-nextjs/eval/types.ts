// Shared shapes of the eval harness (WU-18 plan D2, D5). The runner fills a CaseObservation per run
// of a case; each scorer reads one and returns a ScoreResult, or null when it doesn't apply.
import type { Discarded } from '@vp/domain-schema/rules';
import type { ExtractResponse, RecommendResponse } from '@vp/domain-schema/wire';
import type { LlmErrorCode } from '../src/usecases/errors.ts';
import type { LlmStage } from '../src/usecases/llm-client.ts';
import type { RouteData } from '../src/usecases/routes.ts';
import type { EvalCase } from './cases.ts';

/** One model attempt, as the observer saw it (plan D2). */
export interface Attempt {
  stage: LlmStage;
  /** The output after the SDK's schema parse, before `accept`. Untrusted model text. */
  output: unknown;
  /** Whether the original `accept` check passed; true when the call had none. */
  accepted: boolean;
}

export type Outcome =
  | { kind: 'response'; response: ExtractResponse }
  /** A `/recommend` case's response (the recommend set). */
  | { kind: 'recommendation'; response: RecommendResponse }
  /** A handled failure: the server would answer 502 with this code. */
  | { kind: 'llm-error'; code: LlmErrorCode }
  /** Anything else would be a 500: a bug. */
  | { kind: 'error'; name: string; message: string };

export interface CaseObservation {
  evalCase: EvalCase;
  /** Which repeat of the case this is, from 1. */
  run: number;
  /** Extraction, clarification (or recommend and critic), and their retries, in call order. The judge's are not here. */
  attempts: Attempt[];
  /** What `normalize` discarded, as logged (never the value). */
  discarded: Discarded[];
  outcome: Outcome;
}

export interface ScoreContext {
  /** Every system prompt the model saw, for the leak check. */
  systemPrompts: readonly string[];
  /** The route data a recommend case ran with, for `labelsHonest`. */
  routes?: RouteData;
}

export interface ScoreResult {
  scorer: ScorerName;
  pass: boolean;
  /** Why it failed, or what it counted. Never shown as model output. */
  detail?: string;
}

export const SCORER_NAMES = [
  'wireValid',
  'expectations',
  'canaryAbsent',
  'noPromptLeak',
  'contained',
  'fieldShape',
  'questionAddresses',
  'judgeFields',
  'judgeQuestion',
  'labelsHonest',
  'recommendQuality',
  'judgeRecommendations',
] as const;
export type ScorerName = (typeof SCORER_NAMES)[number];
