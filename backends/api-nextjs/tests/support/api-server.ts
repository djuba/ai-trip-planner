// Runs the built server as a real process, for functional tests (CLAUDE.md §6.3). Node runs Next's
// bin directly, with no shell or .cmd shim: killing a shim on Windows would orphan the server.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createServer, type AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export const BACKEND_DIR = fileURLToPath(new URL('../../', import.meta.url));
export const NEXT_BIN = createRequire(import.meta.url).resolve('next/dist/bin/next');

const HEALTH_ATTEMPTS = 300;
const HEALTH_INTERVAL_MS = 100;
const SIGKILL_AFTER_MS = 5_000;

/**
 * Sets every config variable, so a developer's root .env.local can't change a test: Node's env file
 * loader never overrides a variable that is already set, even to a blank value.
 */
export const baseEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  NODE_ENV: 'production', // Vitest sets `test`, which Next warns about.
  NEXT_TELEMETRY_DISABLED: '1',
  LLM_MODE: 'replay',
  MODEL_FAST: 'test-model-fast',
  MODEL_REASONING: 'test-model-reasoning',
  MODEL_CRITIC: 'test-model-critic',
  WEB_ORIGIN: 'http://localhost:3000',
  ANTHROPIC_API_KEY: '',
});

async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address() as AddressInfo;
  probe.close();
  await once(probe, 'close');
  return port;
}

/** The server process ended before it became healthy. */
export class ApiExitedError extends Error {
  readonly exitCode: number | null;

  constructor(exitCode: number | null, output: string) {
    super(`API server exited with code ${exitCode} before becoming healthy:\n${output}`);
    this.name = 'ApiExitedError';
    this.exitCode = exitCode;
  }
}

export interface RunningApi {
  baseUrl: string;
  stop(): Promise<void>;
}

/** Starts the build made by build-once.ts on a free port and waits for GET /v1/health. */
export async function startApi(options: { env?: NodeJS.ProcessEnv } = {}): Promise<RunningApi> {
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [NEXT_BIN, 'start', '--hostname', '127.0.0.1', '--port', String(port)],
    {
      cwd: BACKEND_DIR,
      env: { ...baseEnv(), ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let output = '';
  const collect = (chunk: Buffer) => {
    output += chunk.toString();
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  let exited = false;
  const exit = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => {
      exited = true;
      resolve(code);
    });
  });

  const stop = async () => {
    if (exited) return;
    if (process.platform === 'win32') {
      // Windows has no SIGTERM, and child.kill() would leave any grandchild running.
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), SIGKILL_AFTER_MS);
      await exit;
      clearTimeout(force);
    }
    await exit;
  };

  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < HEALTH_ATTEMPTS; attempt += 1) {
    if (exited) throw new ApiExitedError(await exit, output);
    try {
      const response = await fetch(`${baseUrl}/v1/health`);
      if (response.ok) return { baseUrl, stop };
    } catch {
      // Not listening yet.
    }
    await delay(HEALTH_INTERVAL_MS);
  }

  await stop();
  throw new Error(`API server did not become healthy:\n${output}`);
}
