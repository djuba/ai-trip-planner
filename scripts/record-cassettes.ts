// `pnpm record:cassettes [--project <integration|functional-api>] [--contract] [filters…]`:
// re-records LLM cassettes with live calls (CLAUDE.md §6.1, §8.3; WU-08 plan D10, WU-09 plan D8).
// This costs money, so it is the one way to record: Vitest lifts forced replay and the network
// guard, and startApi lets the server record, only for runs this script starts. The project
// defaults to integration, and filters are required for Vitest projects. With --contract it runs
// scripts/run-contract.ts (filters optional) in record mode instead. Filter to the tests you mean
// to re-record, then review the cassette diff before committing it.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RecordPlanError, planRecord, type RecordPlan } from './record-cassettes/plan.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
// The bin isn't in vitest's exports map, so resolve it next to the package.json, which is.
const VITEST_BIN = join(
  dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
  'vitest.mjs',
);

const CONTRACT_RUNNER = join(ROOT, 'scripts', 'run-contract.ts');

function main(): Promise<number> {
  let plan: RecordPlan;
  try {
    plan = planRecord(process.argv.slice(2));
  } catch (error) {
    if (error instanceof RecordPlanError) {
      console.error(`record:cassettes: ${error.message}`);
      return Promise.resolve(2);
    }
    throw error;
  }
  // Never overrides a variable already set in the shell.
  const envFile = join(ROOT, '.env.local');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.error('record:cassettes: ANTHROPIC_API_KEY is not set (root .env.local or the shell)');
    return Promise.resolve(2);
  }

  const args =
    plan.kind === 'contract'
      ? [CONTRACT_RUNNER, ...plan.filters]
      : [VITEST_BIN, 'run', '--project', plan.project, ...plan.filters];
  const target = plan.kind === 'contract' ? 'contract' : plan.project;
  console.log(
    `record:cassettes: LIVE calls (costs money) for ${target}: ${plan.filters.join(' ') || '(all)'}`,
  );
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      LLM_MODE: 'record',
      VP_LLM_RECORD: '1',
      // Set here too, so running this file with plain `node` behaves like the pnpm script.
      npm_lifecycle_event: 'record:cassettes',
    },
  });
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

process.exitCode = await main();
