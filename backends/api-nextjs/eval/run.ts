// `pnpm eval --budget <usd> [--repeat n] [--set quality|adversarial|recommend] [--case id] [--no-judge]`
// (WU-18; docs/features/eval.md). LIVE model calls that cost money: opt-in, capped by the budget,
// and never part of a gate (CLAUDE.md §6.8). This file holds everything impure: environment, clock,
// git, files and the console. The logic it wires together is unit-tested.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, loadConfig } from '../src/config.ts';
import { createLlmClient } from '../src/llm/index.ts';
import { parseRouteData } from '../src/usecases/routes.ts';
import { CaseLoadError, loadCases } from './cases.ts';
import { loadPricing, missingPrices } from './cost.ts';
import { EvalPlanError, planEval } from './plan.ts';
import { appendRecord, caseSetHash, sha256, summarize, type RunRecord } from './record.ts';
import {
  CaseSelectionError,
  promptHashParts,
  runEval,
  selectCases,
  worstCaseRunUsd,
  type CallUsage,
} from './runner.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const RESULTS = fileURLToPath(new URL('./results/', import.meta.url));
const ROUTES_PATH = fileURLToPath(new URL('../data/routes.json', import.meta.url));

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function fail(message: string): number {
  console.error(`eval: ${message}`);
  return 2;
}

function printSummary(record: RunRecord): void {
  const pct = (passed: number, total: number) =>
    total === 0 ? '  -' : `${Math.round((100 * passed) / total)}%`.padStart(4);
  for (const [set, summary] of Object.entries(record.sets)) {
    console.log(
      `\n${set}: ${summary.passedRuns}/${summary.runs} runs passed every scorer (${summary.cases} cases)` +
        (summary.notJudged > 0 ? `; ${summary.notJudged} not judged (counted as not passed)` : ''),
    );
    for (const [scorer, { passed, total }] of Object.entries(summary.scorers)) {
      console.log(`  ${scorer.padEnd(18)} ${pct(passed, total)}  ${passed}/${total}`);
    }
  }
  const failing = Object.entries(record.cases).filter(([, c]) => c.passedRuns < c.runs);
  if (failing.length > 0) {
    console.log('\ncases with a failing run:');
    for (const [id, c] of failing) {
      const scorers = Object.entries(c.failed)
        .map(([scorer, n]) => `${scorer}×${n}`)
        .join(', ');
      console.log(`  ${c.set}/${id}: ${c.passedRuns}/${c.runs} (${scorers})`);
    }
  }
  console.log(
    `\ncost US$${record.costUsd.toFixed(4)} of US$${record.budgetUsd}` +
      (record.stoppedAtBudget ? ' (STOPPED AT BUDGET: partial run)' : ''),
  );
}

async function main(): Promise<number> {
  // Never overrides a variable already set in the shell, as record:cassettes does.
  const envFile = join(ROOT, '.env.local');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  let plan;
  let config;
  let selected;
  let pricing;
  try {
    plan = planEval(process.argv.slice(2), process.env);
    // Always live, whatever LLM_MODE says: the eval never reads or writes cassettes.
    config = loadConfig({ ...process.env, LLM_MODE: 'live' });
    pricing = loadPricing();
    selected = selectCases(loadCases(), plan);
    const recommends = selected.some((c) => c.set === 'recommend');
    const missing = missingPrices(
      [
        config.models.fast,
        ...(recommends ? [config.models.reasoning] : []),
        ...(plan.judge || recommends ? [config.models.critic] : []),
      ],
      pricing,
    );
    if (missing.length > 0) return fail(`no price in eval/pricing.json for ${missing.join(', ')}`);
  } catch (error) {
    if (
      error instanceof EvalPlanError ||
      error instanceof ConfigError ||
      error instanceof CaseLoadError ||
      error instanceof CaseSelectionError
    ) {
      return fail(error.message);
    }
    throw error;
  }

  const models = {
    fast: config.models.fast,
    reasoning: config.models.reasoning,
    critic: config.models.critic,
  };
  const routes = parseRouteData(JSON.parse(readFileSync(ROUTES_PATH, 'utf8')));
  const recommends = selected.some((c) => c.set === 'recommend');
  const extracts = selected.some((c) => c.set !== 'recommend');
  const worst = selected.reduce(
    (sum, c) => sum + plan.repeat * worstCaseRunUsd(c, plan.judge, { pricing, models, routes }),
    0,
  );
  console.log(
    `eval: LIVE calls (costs money). ${selected.length} cases × ${plan.repeat}, judge ${plan.judge ? 'on' : 'off'}; ` +
      `models${extracts ? ` fast=${models.fast}` : ''}${recommends ? ` reasoning=${models.reasoning}` : ''}${plan.judge || recommends ? ` critic=${models.critic}` : ''}; ` +
      `prices as of ${pricing.asOf}; budget US$${plan.budgetUsd} (worst case US$${worst.toFixed(2)})`,
  );

  const calls: CallUsage[] = [];
  const { client } = createLlmClient(config, {
    log: (entry) =>
      calls.push({
        model: entry.model,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
      }),
  });
  const run = await runEval(selected, plan, {
    llm: client,
    calls,
    pricing,
    models,
    routes,
    progress: (line) => console.log(`  ${line}`),
  });

  const date = new Date().toISOString();
  const commit = git('rev-parse', 'HEAD');
  const record = summarize({
    date,
    commit,
    dirty: git('status', '--porcelain') !== '',
    models: {
      ...(extracts ? { fast: models.fast } : {}),
      ...(recommends ? { reasoning: models.reasoning } : {}),
      ...(plan.judge || recommends ? { critic: models.critic } : {}),
    },
    promptHash: sha256(promptHashParts()),
    caseSetHash: caseSetHash(selected),
    repeat: plan.repeat,
    judge: plan.judge,
    pricingAsOf: pricing.asOf,
    budgetUsd: plan.budgetUsd,
    stoppedAtBudget: run.stoppedAtBudget,
    costUsd: run.costUsd,
    scored: run.runs.map(({ observation, results, judge }) => ({
      caseId: observation.evalCase.id,
      set: observation.evalCase.set,
      results,
      notJudged: judge?.kind === 'not-judged',
    })),
    calls,
  });
  appendRecord(join(RESULTS, 'runs.jsonl'), record);

  // The per-case detail holds raw model output, so it stays local (git-ignored; plan Q2).
  const detailDir = join(RESULTS, 'runs');
  mkdirSync(detailDir, { recursive: true });
  const detailFile = join(detailDir, `${date.replace(/[:.]/g, '-')}-${commit.slice(0, 7)}.json`);
  writeFileSync(detailFile, JSON.stringify({ record, runs: run.runs }, null, 2) + '\n');

  printSummary(record);
  console.log(`record appended to eval/results/runs.jsonl; detail in ${detailFile}`);
  return 0;
}

process.exitCode = await main();
