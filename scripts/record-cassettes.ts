// `pnpm record:cassettes [vitest filters…]`: re-records LLM cassettes with live calls (CLAUDE.md §6.1,
// §8.3; WU-08 plan D10). This costs money, so it is the one way to record: Vitest lifts forced
// replay and the network guard only for runs this script starts. Filter to the tests you mean to
// re-record, then review the cassette diff before committing it.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
// The bin isn't in vitest's exports map, so resolve it next to the package.json, which is.
const VITEST_BIN = join(
  dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
  'vitest.mjs',
);

function main(): Promise<number> {
  const filters = process.argv.slice(2);
  if (filters.length === 0) {
    console.error('record:cassettes: name the test files to re-record, e.g. llm-client.replay');
    return Promise.resolve(2);
  }
  // Never overrides a variable already set in the shell.
  const envFile = join(ROOT, '.env.local');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.error('record:cassettes: ANTHROPIC_API_KEY is not set (root .env.local or the shell)');
    return Promise.resolve(2);
  }

  console.log(`record:cassettes: LIVE calls (costs money) for: ${filters.join(' ')}`);
  const child = spawn(
    process.execPath,
    [VITEST_BIN, 'run', '--project', 'integration', ...filters],
    {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        LLM_MODE: 'record',
        VP_LLM_RECORD: '1',
        // Set here too, so running this file with plain `node` behaves like the pnpm script.
        npm_lifecycle_event: 'record:cassettes',
      },
    },
  );
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

process.exitCode = await main();
