// @ts-check
import { builtinModules } from 'node:module';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Import boundaries (CLAUDE.md §4.2, §6.6, §9). Exported so scripts/tests/integration/lint-boundaries.test.ts
// can assert they keep failing the build.
export const appsRestrictedImports = {
  patterns: [
    {
      regex: '^@vp/domain-schema/rules(/|$)',
      message: 'apps/ may import @vp/domain-schema/wire; rules are backend-only.',
    },
    {
      regex: '^@vp/api-',
      message: 'apps/ talks to backends over HTTP only; never import backend code.',
    },
    {
      regex: '(^|/)backends/',
      message: 'apps/ talks to backends over HTTP only; never import backend code.',
    },
  ],
};

export const journeysRestrictedImports = {
  patterns: [
    {
      regex: '^@vp/',
      message: 'journeys/ drives a browser against URLs only; no workspace imports.',
    },
    {
      regex: '(^|/)(apps|backends|packages)/',
      message: 'journeys/ drives a browser against URLs only; no workspace imports.',
    },
  ],
};

// The provider contract suite is black-box: it reads generated JSON and talks HTTP, so it judges
// the contract, not the implementation (CLAUDE.md §6.5; WU-07 plan D2).
export const contractSuiteRestrictedImports = {
  patterns: [
    {
      regex: '^@vp/',
      message: 'tests/contract is black-box; read generated/*.json from disk, never import TS.',
    },
    {
      regex: '(^|/)(apps|backends|packages)/',
      message: 'tests/contract is black-box; read generated/*.json from disk, never import TS.',
    },
  ],
};

// Use cases are the inner layer: they depend on the LlmClient interface they own, never on a
// framework, the AI SDK or its implementation in src/llm (CLAUDE.md §9).
export const usecasesRestrictedImports = {
  patterns: [
    {
      regex: '^next(/|$)',
      message: 'src/usecases must not depend on Next.js; route handlers are the adapters.',
    },
    {
      regex: '^(ai(/|$)|@ai-sdk/)',
      message: 'src/usecases depends on the LlmClient interface, not the AI SDK.',
    },
    {
      regex: '(^|/)llm(/|$)',
      message: 'src/usecases depends on the LlmClient interface, not its implementation.',
    },
  ],
};

// Test helpers stay out of shipped code; tests reach them through the ./testing export (§4.2).
export const testingRestrictedImports = {
  patterns: [
    {
      regex: '^@vp/domain-schema/testing(/|$)',
      message: '@vp/domain-schema/testing is for test code only.',
    },
    {
      regex: '(^|/)domain-schema/tests/',
      message: 'domain-schema test helpers are for test code only.',
    },
  ],
};

// Only route handlers in src/app may use Next.js; all other backend logic stays portable (§9).
export const backendNextRestrictedImports = {
  patterns: [
    {
      regex: '^next(/|$)',
      message: 'Only src/app may import Next.js; route handlers are the adapters.',
    },
  ],
};

// A later no-restricted-imports block replaces an earlier one for the same file, so each block
// below lists every pattern that applies to its files.
const TEST_FILES = ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/tests/**'];

// The contract source is bundled into the browser (WU-12), so it must not reach for Node APIs.
// Its gen/ tooling and tests may (WU-04 plan A9).
export const contractSourceRestrictedImports = {
  patterns: [
    {
      // Both specifier forms: `node:fs` and bare `fs` / `fs/promises`.
      regex: `^(node:.*|(${builtinModules.join('|')})(/.*)?)$`,
      message: 'packages/domain-schema/src is bundled for the browser; no Node built-ins.',
    },
  ],
};

export const contractSourceRestrictedGlobals = [
  {
    name: 'process',
    message: 'packages/domain-schema/src is bundled for the browser; no Node globals.',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/next-env.d.ts',
      '**/dist/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'spec/generated/**',
      'contracts/pacts/**',
      '.llm-cassettes/**',
      // Non-production spikes are not linted (docs/decisions/; WU-03).
      'spikes/**',
      // Claude Code's git worktrees for other units: their code isn't this branch's (WU-22
      // deviation 6; vitest.config.ts and .prettierignore already skip them).
      '.claude/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['apps/**/*.{ts,tsx,js,mjs}'],
    rules: {
      'no-restricted-imports': ['error', appsRestrictedImports],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['apps/**/*.{ts,tsx,js,mjs}'],
    ignores: TEST_FILES,
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...appsRestrictedImports.patterns, ...testingRestrictedImports.patterns] },
      ],
    },
  },
  {
    files: ['backends/**/*.{ts,tsx,js,mjs}'],
    ignores: TEST_FILES,
    rules: {
      'no-restricted-imports': ['error', testingRestrictedImports],
    },
  },
  {
    files: ['backends/api-nextjs/src/**/*.{ts,tsx}'],
    ignores: [...TEST_FILES, 'backends/api-nextjs/src/app/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...testingRestrictedImports.patterns,
            ...backendNextRestrictedImports.patterns,
          ],
        },
      ],
    },
  },
  {
    files: ['packages/domain-schema/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', contractSourceRestrictedImports],
      'no-restricted-globals': ['error', ...contractSourceRestrictedGlobals],
    },
  },
  {
    files: ['backends/api-nextjs/src/usecases/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...testingRestrictedImports.patterns, ...usecasesRestrictedImports.patterns] },
      ],
    },
  },
  {
    files: ['tests/journeys/**/*.{ts,tsx,js,mjs}'],
    rules: {
      'no-restricted-imports': ['error', journeysRestrictedImports],
    },
  },
  {
    files: ['tests/contract/**/*.{ts,tsx,js,mjs}'],
    rules: {
      'no-restricted-imports': ['error', contractSuiteRestrictedImports],
    },
  },
  prettier,
);
