// Test harness for every Vitest layer (CLAUDE.md §6.3) and the coverage floor (§6.4).
// One root config so unit + integration coverage is measured in a single run across packages.
// Playwright owns `*.spec.ts` (web functional, journeys); Vitest never collects those.
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';
import { recordingAllowed } from './scripts/test-support/llm-guard.ts';

const excludeEverywhere = [
  ...configDefaults.exclude,
  'spikes/**',
  'tests/journeys/**',
  'apps/web-nextjs/tests/functional/**',
  '**/.next/**',
  '**/.next-journeys/**',
  // Claude Code's git worktrees for other units (WU-20 plan, deviations): their tests aren't ours.
  '.claude/**',
  // Needs the Firestore emulator; only the `firestore` project below collects it.
  'backends/api-nextjs/tests/firestore/**',
];

const FUNCTIONAL = '**/tests/functional/**/*.test.{ts,tsx}';
const FUNCTIONAL_API = 'backends/api-nextjs/tests/functional/**/*.test.ts';
const INTEGRATION = '**/tests/integration/**/*.test.{ts,tsx}';
// Provider contract tests need a running backend; scripts/run-contract.ts provides one (§6.5).
const CONTRACT = ['tests/contract/conformance/**/*.test.ts', 'tests/contract/pact-verify.test.ts'];
// Consumer Pact tests run against Pact's own mock server, before the provider suite (WU-12 plan D6).
const CONTRACT_CONSUMER = 'apps/**/*.pact.test.{ts,tsx}';

// No gated test calls a live LLM (§6.1; WU-08 plan D10). Only `pnpm record:cassettes` lifts these.
const BLOCK_NETWORK = ['scripts/test-support/block-network.ts'];
// Web component tests opt into jsdom per file (`@vitest-environment jsdom`); this setup adds the
// Testing Library matchers and cleanup only where a DOM exists (WU-12 plan, review fix 2).
const DOM_SETUP = ['apps/web-nextjs/tests/support/setup-dom.ts'];
// The web app's `@/` import alias (apps/web-nextjs/tsconfig.json). Only `@/`, never `@scope/`.
const WEB_SRC = fileURLToPath(new URL('./apps/web-nextjs/src/', import.meta.url));
const llmEnv: Record<string, string> = recordingAllowed(process.env) ? {} : { LLM_MODE: 'replay' };

export default defineConfig({
  resolve: { alias: [{ find: /^@\//, replacement: WEB_SRC }] },
  test: {
    env: llmEnv,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          setupFiles: [...BLOCK_NETWORK, ...DOM_SETUP],
          include: ['**/*.test.{ts,tsx}'],
          exclude: [...excludeEverywhere, INTEGRATION, FUNCTIONAL, ...CONTRACT, CONTRACT_CONSUMER],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          setupFiles: [...BLOCK_NETWORK, ...DOM_SETUP],
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
        extends: true,
        test: {
          name: 'contract-consumer',
          // The Pact mock server listens on loopback, which the network guard allows.
          setupFiles: BLOCK_NETWORK,
          include: [CONTRACT_CONSUMER],
          exclude: excludeEverywhere,
          // One pact file, so interactions are written by one worker in order.
          fileParallelism: false,
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
      {
        // Run by `pnpm test:firestore`, which starts the emulator; not part of `pnpm verify`.
        extends: true,
        test: {
          name: 'firestore',
          include: ['backends/api-nextjs/tests/firestore/**/*.test.ts'],
          exclude: configDefaults.exclude,
          testTimeout: 30_000,
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
