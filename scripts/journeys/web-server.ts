// Builds and starts web-nextjs for the journeys (WU-15 plan D2), the way api-server.ts runs the
// API: Node runs Next's bin directly, with no shell or .cmd shim, so stopping it on Windows can't
// orphan the server.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createServer, type AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export const WEB_DIR = fileURLToPath(new URL('../../apps/web-nextjs/', import.meta.url));
const NEXT_BIN = createRequire(new URL('package.json', `file://${WEB_DIR}`)).resolve(
  'next/dist/bin/next',
);

const READY_ATTEMPTS = 300;
const READY_INTERVAL_MS = 100;
const SIGKILL_AFTER_MS = 5_000;

export async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address() as AddressInfo;
  probe.close();
  await once(probe, 'close');
  return port;
}

const webProcessEnv = (env: Record<string, string>): NodeJS.ProcessEnv => ({
  ...process.env,
  NODE_ENV: 'production',
  ...env,
});

/** `next build` with `env` (the API URL is inlined now, plan D2). Throws on failure. */
export function buildWeb(env: Record<string, string>): void {
  const result = spawnSync(process.execPath, [NEXT_BIN, 'build'], {
    cwd: WEB_DIR,
    env: webProcessEnv(env),
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`web-nextjs: next build failed with exit code ${result.status}`);
  }
}

export interface RunningWeb {
  baseUrl: string;
  stop(): Promise<void>;
}

/** Starts the build on 127.0.0.1:`port` and waits until `/` answers 200. */
export async function startWeb(port: number, env: Record<string, string>): Promise<RunningWeb> {
  const child = spawn(
    process.execPath,
    [NEXT_BIN, 'start', '--hostname', '127.0.0.1', '--port', String(port)],
    { cwd: WEB_DIR, env: webProcessEnv(env), stdio: ['ignore', 'pipe', 'pipe'] },
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
  for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
    if (exited) {
      throw new Error(`web-nextjs exited with code ${await exit} before serving:\n${output}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return { baseUrl, stop };
    } catch {
      // Not listening yet.
    }
    await delay(READY_INTERVAL_MS);
  }
  await stop();
  throw new Error(`web-nextjs did not start serving:\n${output}`);
}
