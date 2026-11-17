// `pnpm test:firestore`: runs the usage-store suite against the real Firestore emulator in Docker
// (WU-23a plan D7). Proves the fake in backends/api-nextjs/tests/support/fake-firestore.ts. Needs
// Docker, so it isn't part of `pnpm verify`; CI runs it in the `image` job.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
// Pinned to an exact release (CLAUDE.md §3). Confirm the tag exists when bumping it.
const IMAGE = 'gcr.io/google.com/cloudsdktool/google-cloud-cli:592.0.0-emulators';
const CONTAINER_PORT = 8080;
const PROJECT = 'vp-usage-test';
const READY_ATTEMPTS = 120;
const READY_INTERVAL_MS = 500;

async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address() as AddressInfo;
  probe.close();
  await once(probe, 'close');
  return port;
}

async function waitForEmulator(url: string): Promise<void> {
  for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
    try {
      // The emulator answers its root with "Ok" once it is up.
      if ((await fetch(url)).ok) return;
    } catch {
      // Not listening yet.
    }
    await delay(READY_INTERVAL_MS);
  }
  throw new Error(`the Firestore emulator did not start at ${url}`);
}

function runVitest(host: string): Promise<number> {
  const child = spawn(
    process.execPath,
    ['node_modules/vitest/vitest.mjs', 'run', '--project', 'firestore'],
    {
      cwd: ROOT,
      env: { ...process.env, FIRESTORE_EMULATOR_HOST: host, GOOGLE_CLOUD_PROJECT: PROJECT },
      stdio: 'inherit',
    },
  );
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function main(): Promise<number> {
  const name = `vp-firestore-test-${process.pid}`;
  const hostPort = await freePort();
  const host = `127.0.0.1:${hostPort}`;
  const started = spawnSync(
    'docker',
    [
      'run',
      '--detach',
      '--name',
      name,
      '--publish',
      `127.0.0.1:${hostPort}:${CONTAINER_PORT}`,
      IMAGE,
      'gcloud',
      'emulators',
      'firestore',
      'start',
      `--host-port=0.0.0.0:${CONTAINER_PORT}`,
    ],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  if (started.error) throw new Error(`docker could not run: ${started.error.message}`);
  if (started.status !== 0) throw new Error(`docker run failed with exit code ${started.status}`);
  let passed = false;
  try {
    await waitForEmulator(`http://${host}`);
    const code = await runVitest(host);
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
  console.error(`test:firestore: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
