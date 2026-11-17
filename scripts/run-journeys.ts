// `pnpm test:journeys [playwright args]`: the integrated stack for the journeys (CLAUDE.md §6.6;
// WU-15 plan D1, D2, D5). Builds and starts api-nextjs in replay mode, configured as when hosted,
// with a fresh invite code; builds web-nextjs against it into its own dist dir; runs Playwright in
// tests/journeys/ with only URLs and the code; stops both. `pnpm record:cassettes --journeys`
// runs it in record mode instead (plan D6).
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import buildOnce from '../backends/api-nextjs/tests/support/build-once.ts';
import {
  CASSETTE_DIR,
  startApi,
  type RunningApi,
} from '../backends/api-nextjs/tests/support/api-server.ts';
import { freshInvite } from './contract/plan-run.ts';
import {
  apiEnv,
  failureCassettes,
  planStack,
  playwrightEnv,
  webEnv,
  type CassetteFile,
} from './journeys/plan-stack.ts';
import { buildWeb, freePort, startWeb, type RunningWeb } from './journeys/web-server.ts';
import { recordingAllowed } from './test-support/llm-guard.ts';

const JOURNEYS_DIR = fileURLToPath(new URL('../tests/journeys/', import.meta.url));
const PLAYWRIGHT_CLI = createRequire(join(JOURNEYS_DIR, 'package.json')).resolve(
  '@playwright/test/cli',
);

/** A copy of the cassettes with journey 4's responses swapped for a provider error (plan D5). */
async function replayCassetteDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'vp-journeys-cassettes-'));
  const files: CassetteFile[] = [];
  for (const name of await readdir(CASSETTE_DIR)) {
    if (!name.endsWith('.json')) continue;
    const text = await readFile(join(CASSETTE_DIR, name), 'utf8');
    files.push({ name, text });
  }
  const swapped = new Map(failureCassettes(files).map((file) => [file.name, file.text]));
  for (const { name, text } of files) {
    await writeFile(join(dir, name), swapped.get(name) ?? text);
  }
  return dir;
}

function runPlaywright(args: string[], env: Record<string, string>): Promise<number> {
  const child = spawn(process.execPath, [PLAYWRIGHT_CLI, 'test', ...args], {
    cwd: JOURNEYS_DIR,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function main(): Promise<number> {
  const recording = recordingAllowed(process.env);
  const plan = planStack(process.argv.slice(2), recording);
  console.log(`test:journeys: ${plan.mode} mode`);

  let api: RunningApi | undefined;
  let web: RunningWeb | undefined;
  let cassetteDir: string | undefined;
  const stop = async () => {
    const [runningWeb, runningApi, dir] = [web, api, cassetteDir];
    web = undefined;
    api = undefined;
    cassetteDir = undefined;
    await runningWeb?.stop();
    await runningApi?.stop();
    if (dir) await rm(dir, { recursive: true, force: true });
  };
  // Ctrl-C or a killed gate must not leave either server holding its port (WU-06 R4).
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void stop().finally(() => process.exit(130));
    });
  }

  try {
    if (plan.mode === 'replay') cassetteDir = await replayCassetteDir();
    // The web port is chosen first: the API's WEB_ORIGIN must name it before the web build exists.
    const webPort = await freePort();
    const webOrigin = `http://127.0.0.1:${webPort}`;
    const invite = freshInvite(undefined, { recording: plan.mode === 'record' });

    buildOnce();
    api = await startApi({
      env: apiEnv({
        mode: plan.mode,
        webOrigin,
        inviteServerEnv: invite.serverEnv,
        cassetteDir,
      }),
    });
    console.log(`test:journeys: api-nextjs at ${api.baseUrl}`);

    const env = webEnv(api.baseUrl);
    buildWeb(env);
    web = await startWeb(webPort, env);
    console.log(`test:journeys: web-nextjs at ${web.baseUrl}`);

    return await runPlaywright(
      plan.playwrightArgs,
      playwrightEnv({ mode: plan.mode, webBaseUrl: web.baseUrl, inviteCode: invite.code }),
    );
  } finally {
    await stop();
  }
}

process.exitCode = await main();
