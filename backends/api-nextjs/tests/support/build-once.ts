// Vitest globalSetup for the functional-api project: one build per run, shared by every test file.
import { spawnSync } from 'node:child_process';
import { BACKEND_DIR, NEXT_BIN, baseEnv } from './api-server.ts';

export default function buildOnce(): void {
  const result = spawnSync(process.execPath, [NEXT_BIN, 'build'], {
    cwd: BACKEND_DIR,
    // Deliberately invalid: config is read at startup, so a build must not depend on it.
    env: { ...baseEnv(), LLM_MODE: 'invalid-at-build-time', WEB_ORIGIN: 'not-an-origin' },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`next build failed with exit code ${result.status}`);
  }
}
