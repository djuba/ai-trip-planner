// `pnpm test:contract`: runs the provider contract suite (CLAUDE.md §6.5) against a backend.
// By default it builds and starts api-nextjs on a free port and stops it afterwards; with
// --external it tests API_BASE_URL and starts nothing (plan D8). The suite itself only ever sees
// CONTRACT_TARGET_URL, so it stays black-box; this runner is the only part that knows a backend.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import buildOnce from '../backends/api-nextjs/tests/support/build-once.ts';
import { startApi, type RunningApi } from '../backends/api-nextjs/tests/support/api-server.ts';
import { RunPlanError, freshInvite, planRun, type RunPlan } from './contract/plan-run.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
// The bin isn't in vitest's exports map, so resolve it next to the package.json, which is.
const VITEST_BIN = join(
  dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
  'vitest.mjs',
);
const DEFAULT_WEB_ORIGIN = 'http://localhost:3000';

function runVitest(args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const child = spawn(process.execPath, [VITEST_BIN, 'run', '--project', 'contract', ...args], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
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
      const invite = freshInvite();
      inviteCode = invite.code;
      api = await startApi({ env: { WEB_ORIGIN: webOrigin, ...invite.serverEnv } });
      baseUrl = api.baseUrl;
    } else {
      baseUrl = plan.baseUrl;
      inviteCode = plan.inviteCode;
      webOrigin = process.env.WEB_ORIGIN?.trim() || DEFAULT_WEB_ORIGIN;
    }
    console.log(`test:contract: target ${baseUrl}, WEB_ORIGIN ${webOrigin}`);
    return await runVitest(plan.vitestArgs, {
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
