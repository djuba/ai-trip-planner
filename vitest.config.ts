// Test harness for every Vitest layer (CLAUDE.md §6.3) and the coverage floor (§6.4).
// One root config so unit + integration coverage is measured in a single run across packages.
// Playwright owns `*.spec.ts` (web functional, journeys); Vitest never collects those.
import { configDefaults, defineConfig } from 'vitest/config';
import { recordingAllowed } from './scripts/test-support/llm-guard.ts';

const excludeEverywhere = [
  ...configDefaults.exclude,
  'spikes/**',
  'tests/journeys/**',
  'apps/web-nextjs/tests/functional/**',
  '**/.next/**',
];

const FUNCTIONAL = '**/tests/functional/**/*.test.{ts,tsx}';
const FUNCTIONAL_API = 'backends/api-nextjs/tests/functional/**/*.test.ts';
const INTEGRATION = '**/tests/integration/**/*.test.{ts,tsx}';
// Provider contract tests need a running backend; scripts/run-contract.ts provides one (§6.5).
const CONTRACT = ['tests/contract/conformance/**/*.test.ts', 'tests/contract/pact-verify.test.ts'];

// No gated test calls a live LLM (§6.1; WU-08 plan D10). Only `pnpm record:cassettes` lifts these.
const BLOCK_NETWORK = ['scripts/test-support/block-network.ts'];
const llmEnv: Record<string, string> = recordingAllowed(process.env) ? {} : { LLM_MODE: 'replay' };

export default defineConfig({
  test: {
    env: llmEnv,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          setupFiles: BLOCK_NETWORK,
          include: ['**/*.test.{ts,tsx}'],
          exclude: [...excludeEverywhere, INTEGRATION, FUNCTIONAL, ...CONTRACT],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          setupFiles: BLOCK_NETWORK,
          include: [INTEGRATION],
          exclude: [...excludeEverywhere, FUNCTIONAL],
        },
      },
      {
        extends: true,
        test: {
          name: 'functional',
          setupFiles: BLOCK_NETWORK,
          include: [FUNCTIONAL],
          exclude: [...excludeEverywhere, FUNCTIONAL_API],
          testTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'contract',
          // No network guard: it must reach any API_BASE_URL host (plan D10, review #4).
          include: CONTRACT,
          exclude: excludeEverywhere,
          testTimeout: 30_000,
        },
      },
      {
        // Its own project so only these tests pay for `next build`, which runs once per run.
        extends: true,
        test: {
          name: 'functional-api',
          setupFiles: BLOCK_NETWORK,
          include: [FUNCTIONAL_API],
          exclude: excludeEverywhere,
          globalSetup: ['backends/api-nextjs/tests/support/build-once.ts'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      // Product source only; tooling in scripts/ is proven by its own tests, not measured.
      include: ['apps/*/src/**', 'backends/*/src/**', 'packages/*/src/**'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts'],
      reporter: ['text-summary', 'text', 'html'],
      // §6.4: a floor, never lowered to make a build pass.
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
        'packages/domain-schema/src/**': { lines: 95, branches: 95 },
        'backends/api-nextjs/src/usecases/**': { lines: 95, branches: 95 },
      },
    },
  },
});
