// `pnpm test:contract`: runs the consumer Pact tests, which rewrite contracts/pacts/ (WU-12),
// then the provider contract suite (CLAUDE.md §6.5) against a backend. By default it builds and
// starts api-nextjs on a free port and stops it afterwards; with --external it tests API_BASE_URL,
// starts nothing and verifies the committed pact as it is (plan D8). The suite itself only ever
// sees CONTRACT_TARGET_URL, so it stays black-box; this runner is the only part that knows a
// backend.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import buildOnce from '../backends/api-nextjs/tests/support/build-once.ts';
import { startApi, type RunningApi } from '../backends/api-nextjs/tests/support/api-server.ts';
import {
  CONSUMER_PACTS_DIR,
  RunPlanError,
  freshInvite,
  pactDriftError,
  planRun,
  type RunPlan,
} from './contract/plan-run.ts';
import { recordingAllowed } from './test-support/llm-guard.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
// The bin isn't in vitest's exports map, so resolve it next to the package.json, which is.
const VITEST_BIN = join(
  dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
  'vitest.mjs',
);
const DEFAULT_WEB_ORIGIN = 'http://localhost:3000';

// Written fresh each run, so an interaction removed from the tests can't linger (WU-12 plan D6).
const CONSUMER_PACT = join(ROOT, CONSUMER_PACTS_DIR, 'web-nextjs-vacation-api.json');

function runVitest(
  project: 'contract' | 'contract-consumer',
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const child = spawn(process.execPath, [VITEST_BIN, 'run', '--project', project, ...args], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

/** Rewrites the pact, restoring the previous file if the run fails; in CI, fails on pact drift. */
async function runConsumer(): Promise<number> {
  const previous = existsSync(CONSUMER_PACT) ? readFileSync(CONSUMER_PACT) : undefined;
  rmSync(CONSUMER_PACT, { force: true });
  // It runs unfiltered: vitest arguments select provider tests only.
  const exit = await runVitest('contract-consumer', [], {
    ...process.env,
    PACT_DO_NOT_TRACK: 'true',
  });
  if (exit !== 0) {
    if (previous !== undefined) writeFileSync(CONSUMER_PACT, previous);
    return exit;
  }
  if (!process.env.CI) return 0;
  const status = spawnSync('git', ['status', '--porcelain', '--', CONSUMER_PACTS_DIR], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const drift = status.status === 0 ? pactDriftError(status.stdout) : 'git status failed';
  if (drift === undefined) return 0;
  console.error(`test:contract: ${drift}`);
  return 1;
}

async function main(): Promise<number> {
  let plan: RunPlan;
  try {
    plan = planRun(process.argv.slice(2), process.env);
  } catch (error) {
    if (error instanceof RunPlanError) {
      console.error(`test:contract: ${error.message}`);
      return 2;
    }
    throw error;
  }
  for (const notice of plan.notices) console.log(`test:contract: ${notice}`);

  // Consumer first: the provider verification below replays the pact it writes (WU-12 plan D6).
  // Only the project gate rewrites the pact; --external and recording runs verify it as committed.
  if (plan.startServer && !recordingAllowed(process.env)) {
    const consumerExit = await runConsumer();
    if (consumerExit !== 0) return consumerExit;
  }

  let api: RunningApi | undefined;
  const stop = async () => {
    const running = api;
    api = undefined;
    await running?.stop();
  };
  // Ctrl-C or a killed gate must not leave `next start` holding the port (WU-06 R4).
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void stop().finally(() => process.exit(130));
    });
  }

  try {
    let baseUrl: string;
    let webOrigin: string;
    let inviteCode: string;
    if (plan.startServer) {
      buildOnce();
      webOrigin = DEFAULT_WEB_ORIGIN;
      const invite = freshInvite(undefined, { recording: recordingAllowed(process.env) });
      inviteCode = invite.code;
      api = await startApi({ env: { WEB_ORIGIN: webOrigin, ...invite.serverEnv } });
      baseUrl = api.baseUrl;
    } else {
      baseUrl = plan.baseUrl;
      inviteCode = plan.inviteCode;
      webOrigin = process.env.WEB_ORIGIN?.trim() || DEFAULT_WEB_ORIGIN;
    }
    console.log(`test:contract: target ${baseUrl}, WEB_ORIGIN ${webOrigin}`);
    return await runVitest('contract', plan.vitestArgs, {
      ...process.env,
      CONTRACT_TARGET_URL: baseUrl,
      CONTRACT_INVITE_CODE: inviteCode,
      WEB_ORIGIN: webOrigin,
      PACT_DO_NOT_TRACK: 'true',
    });
  } finally {
    await stop();
  }
}

process.exitCode = await main();
