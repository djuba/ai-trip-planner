// One line per eval run in results/runs.jsonl (WU-18 plan D7): the schema, the summary of a run's
// scores, and the append/read helpers.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { EVAL_SETS, type EvalCase, type EvalSet } from './cases.ts';
import { SCORER_NAMES, type ScoreResult } from './types.ts';

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const Count = z.int().nonnegative();
const ScorerKey = z.enum(SCORER_NAMES);
const SetKey = z.enum(EVAL_SETS);

export const RunRecord = z.strictObject({
  date: z.iso.datetime(),
  commit: z.string().min(1),
  dirty: z.boolean(),
  models: z.record(z.string(), z.string()),
  promptHash: Hex64,
  caseSetHash: Hex64,
  repeat: z.int().positive(),
  judge: z.boolean(),
  pricingAsOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sets: z.partialRecord(
    SetKey,
    z.strictObject({
      cases: Count,
      runs: Count,
      passedRuns: Count,
      /** Runs whose judge call failed. Never counted as passed (WU-18 unit review #2). */
      notJudged: Count,
      scorers: z.partialRecord(ScorerKey, z.strictObject({ passed: Count, total: Count })),
    }),
  ),
  cases: z.record(
    z.string(),
    z.strictObject({
      set: SetKey,
      runs: Count,
      passedRuns: Count,
      notJudged: Count,
      failed: z.partialRecord(ScorerKey, Count),
    }),
  ),
  usage: z.record(
    z.string(),
    z.strictObject({ requests: Count, inputTokens: Count, outputTokens: Count }),
  ),
  costUsd: z.number().nonnegative(),
  budgetUsd: z.number().positive(),
  stoppedAtBudget: z.boolean(),
});
export type RunRecord = z.infer<typeof RunRecord>;

export function sha256(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex');
}

export function caseSetHash(cases: readonly EvalCase[]): string {
  const sorted = [...cases].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return sha256([JSON.stringify(sorted)]);
}

export interface SummaryInput {
  date: string;
  commit: string;
  dirty: boolean;
  models: Record<string, string>;
  promptHash: string;
  caseSetHash: string;
  repeat: number;
  judge: boolean;
  pricingAsOf: string;
  budgetUsd: number;
  stoppedAtBudget: boolean;
  costUsd: number;
  /** One entry is one run of one case. */
  scored: readonly {
    caseId: string;
    set: EvalSet;
    results: readonly ScoreResult[];
    /** The judge was asked and gave no usable verdict. */
    notJudged?: boolean;
  }[];
  calls: readonly {
    model: string;
    inputTokens: number | undefined;
    outputTokens: number | undefined;
  }[];
}

export function summarize(input: SummaryInput): RunRecord {
  const sets: RunRecord['sets'] = {};
  const cases: RunRecord['cases'] = {};
  const seenCases = new Map<EvalSet, Set<string>>();

  for (const run of input.scored) {
    const notJudged = run.notJudged === true;
    const passed = !notJudged && run.results.every((r) => r.pass);

    const setStats = (sets[run.set] ??= {
      cases: 0,
      runs: 0,
      passedRuns: 0,
      notJudged: 0,
      scorers: {},
    });
    let ids = seenCases.get(run.set);
    if (ids === undefined) {
      ids = new Set<string>();
      seenCases.set(run.set, ids);
    }
    if (!ids.has(run.caseId)) {
      ids.add(run.caseId);
      setStats.cases += 1;
    }
    setStats.runs += 1;
    if (passed) setStats.passedRuns += 1;
    if (notJudged) setStats.notJudged += 1;

    const caseStats = (cases[run.caseId] ??= {
      set: run.set,
      runs: 0,
      passedRuns: 0,
      notJudged: 0,
      failed: {},
    });
    caseStats.runs += 1;
    if (passed) caseStats.passedRuns += 1;
    if (notJudged) caseStats.notJudged += 1;

    for (const r of run.results) {
      const tally = (setStats.scorers[r.scorer] ??= { passed: 0, total: 0 });
      tally.total += 1;
      if (r.pass) tally.passed += 1;
      else caseStats.failed[r.scorer] = (caseStats.failed[r.scorer] ?? 0) + 1;
    }
  }

  const usage: RunRecord['usage'] = {};
  for (const call of input.calls) {
    const u = (usage[call.model] ??= { requests: 0, inputTokens: 0, outputTokens: 0 });
    u.requests += 1;
    u.inputTokens += call.inputTokens ?? 0;
    u.outputTokens += call.outputTokens ?? 0;
  }

  return RunRecord.parse({
    date: input.date,
    commit: input.commit,
    dirty: input.dirty,
    models: input.models,
    promptHash: input.promptHash,
    caseSetHash: input.caseSetHash,
    repeat: input.repeat,
    judge: input.judge,
    pricingAsOf: input.pricingAsOf,
    sets,
    cases,
    usage,
    costUsd: Math.round(input.costUsd * 1_000_000) / 1_000_000,
    budgetUsd: input.budgetUsd,
    stoppedAtBudget: input.stoppedAtBudget,
  });
}

export function appendRecord(path: string, record: RunRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`);
}

export function readRecords(path: string): RunRecord[] {
  if (!existsSync(path)) return [];
  const records: RunRecord[] = [];
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (line.trim() === '') return;
      try {
        records.push(RunRecord.parse(JSON.parse(line)));
      } catch (error) {
        throw new Error(`${path} line ${index + 1}: ${(error as Error).message}`, { cause: error });
      }
    });
  return records;
}
