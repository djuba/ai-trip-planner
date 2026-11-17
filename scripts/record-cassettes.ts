// `pnpm record:cassettes [--project <integration|functional-api>] [--contract] [filters…]`:
// re-records LLM cassettes with live calls (CLAUDE.md §6.1, §8.3; WU-08 plan D10, WU-09 plan D8).
// This costs money, so it is the one way to record: Vitest lifts forced replay and the network
// guard, and startApi lets the server record, only for runs this script starts. The project
// defaults to integration, and filters are required for Vitest projects. With --contract it runs
// scripts/run-contract.ts (filters optional) in record mode instead. Filter to the tests you mean
// to re-record, then review the cassette diff before committing it. --journeys [filters] does the
// same for scripts/run-journeys.ts (filters are Playwright args). --prune needs no key and makes
// no live call: it replays every gated suite with a usage log, then deletes the cassettes none
// of them replayed (only if all passed), keeping those the 502 tests copy (prune.ts).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RecordPlanError, planRecord, type RecordPlan } from './record-cassettes/plan.ts';
import { afterAllPass, cassettesToPrune, type CassetteFile } from './record-cassettes/prune.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
// The bin isn't in vitest's exports map, so resolve it next to the package.json, which is.
const VITEST_BIN = join(
  dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
  'vitest.mjs',
);

const CONTRACT_RUNNER = join(ROOT, 'scripts', 'run-contract.ts');
const JOURNEY_RUNNER = join(ROOT, 'scripts', 'run-journeys.ts');
const CASSETTE_DIR = join(ROOT, '.llm-cassettes', 'api-nextjs');

function run(args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const child = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env });
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function prune(): Promise<number> {
  const scratch = mkdtempSync(join(tmpdir(), 'vp-prune-'));
  const log = join(scratch, 'usage.log');
  // Replay only: no record flags, and no key is needed or passed on.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LLM_MODE: 'replay',
    LLM_CASSETTE_USAGE_LOG: log,
  };
  delete env.VP_LLM_RECORD;
  try {
    const suites = [
      [VITEST_BIN, 'run', '--project', 'integration'],
      [VITEST_BIN, 'run', '--project', 'functional-api'],
      [CONTRACT_RUNNER],
      [JOURNEY_RUNNER],
    ].map((args) => () => run(args, env));
    return await afterAllPass(suites, deleteUnused, () => {
      console.error('record:cassettes --prune: a suite failed, so nothing was deleted');
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  function deleteUnused(): number {
    const used = new Set(
      existsSync(log)
        ? readFileSync(log, 'utf8')
            .split('\n')
            .filter((line) => line !== '')
        : [],
    );
    const files: CassetteFile[] = readdirSync(CASSETTE_DIR)
      .filter((name) => name.endsWith('.json'))
      .map((name) => ({
        key: name.slice(0, -'.json'.length),
        requestBody: JSON.stringify(
          (
            JSON.parse(readFileSync(join(CASSETTE_DIR, name), 'utf8')) as {
              request: { body: unknown };
            }
          ).request.body,
        ),
      }));
    const doomed = cassettesToPrune(files, used);
    for (const key of doomed) {
      unlinkSync(join(CASSETTE_DIR, `${key}.json`));
      console.log(`deleted ${key}.json`);
    }
    console.log(`record:cassettes --prune: deleted ${doomed.length} of ${files.length} cassettes`);
    return 0;
  }
}

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
  if (plan.kind === 'prune') return prune();
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
      : plan.kind === 'journeys'
        ? [JOURNEY_RUNNER, ...plan.filters]
        : [VITEST_BIN, 'run', '--project', plan.project, ...plan.filters];
  const target = plan.kind === 'vitest' ? plan.project : plan.kind;
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
