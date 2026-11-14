// `pnpm test:image`: builds the api-nextjs image, checks it runs as a non-root user and holds no
// secrets, runs it in replay mode and runs the provider contract tests against it (WU-20 plan D5).
// Needs Docker, so it isn't part of `pnpm verify`; CI runs it in the `image` job.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { CONTRACT_TEST_ENV } from '../backends/api-nextjs/tests/support/api-server.ts';
import { freshInvite } from './contract/plan-run.ts';
import {
  buildArgs,
  imageProblems,
  inspectEnvArgs,
  probeArgs,
  runArgs,
  type Probe,
} from './image/plan-image.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const HEALTH_ATTEMPTS = 120;
const HEALTH_INTERVAL_MS = 500;

function docker(args: string[], capture = false): string {
  const result = spawnSync('docker', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error) throw new Error(`docker could not run: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(`docker ${args[0]} failed with exit code ${result.status}`);
  return capture ? result.stdout : '';
}

async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address() as AddressInfo;
  probe.close();
  await once(probe, 'close');
  return port;
}

async function waitForHealth(baseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < HEALTH_ATTEMPTS; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/v1/health`)).ok) return;
    } catch {
      // Not listening yet.
    }
    await delay(HEALTH_INTERVAL_MS);
  }
  throw new Error(`the container did not become healthy at ${baseUrl}`);
}

function runContract(baseUrl: string, inviteCode: string): Promise<number> {
  const child = spawn(process.execPath, ['scripts/run-contract.ts', '--external'], {
    cwd: ROOT,
    env: {
      ...process.env,
      API_BASE_URL: baseUrl,
      WEB_ORIGIN: CONTRACT_TEST_ENV.WEB_ORIGIN,
      CONTRACT_INVITE_CODE: inviteCode,
    },
    stdio: 'inherit',
  });
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function main(): Promise<number> {
  console.log('test:image: building the image');
  docker(buildArgs());

  const probe = JSON.parse(docker(probeArgs(), true)) as Probe;
  const configEnv = JSON.parse(docker(inspectEnvArgs(), true)) as string[];
  const problems = imageProblems(probe, configEnv);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`test:image: ${problem}`);
    return 1;
  }
  console.log(`test:image: runs as uid ${probe.uid}, no .env files, no secret-like variables`);

  const name = `vp-api-test-${process.pid}`;
  const hostPort = await freePort();
  const baseUrl = `http://127.0.0.1:${hostPort}`;
  let passed = false;
  // The container gets only the code's hash; the suite gets the code (WU-22 plan D7).
  const invite = freshInvite();
  docker(runArgs({ name, hostPort, env: { ...CONTRACT_TEST_ENV, ...invite.serverEnv } }), true);
  try {
    await waitForHealth(baseUrl);
    const code = await runContract(baseUrl, invite.code);
    passed = code === 0;
    return code;
  } finally {
    if (!passed) spawnSync('docker', ['logs', name], { stdio: 'inherit' });
    spawnSync('docker', ['rm', '--force', name], { stdio: 'ignore' });
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`test:image: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
