// Test harness for every Vitest layer (CLAUDE.md §6.3) and the coverage floor (§6.4).
// One root config so unit + integration coverage is measured in a single run across packages.
// Playwright owns `*.spec.ts` (web functional, journeys); Vitest never collects those.
import { configDefaults, defineConfig } from 'vitest/config';

const excludeEverywhere = [
  ...configDefaults.exclude,
  'spikes/**',
  'journeys/**',
  'apps/web-nextjs/test/functional/**',
  '**/.next/**',
];

const FUNCTIONAL = '**/test/functional/**/*.test.{ts,tsx}';
const INTEGRATION = '**/*.int.test.{ts,tsx}';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['**/*.test.{ts,tsx}'],
          exclude: [...excludeEverywhere, INTEGRATION, FUNCTIONAL],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: [INTEGRATION],
          exclude: [...excludeEverywhere, FUNCTIONAL],
        },
      },
      {
        extends: true,
        test: {
          name: 'functional',
          include: [FUNCTIONAL],
          exclude: excludeEverywhere,
          testTimeout: 60_000,
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
        'backends/api-nextjs/src/pipeline/**': { lines: 95, branches: 95 },
      },
    },
  },
});
