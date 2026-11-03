// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Import boundaries (CLAUDE.md §4.2, §6.6, §9). Exported so scripts/lint-boundaries.int.test.ts
// can assert they keep failing the build.
export const appsRestrictedImports = {
  patterns: [
    {
      regex: '^@vp/domain-schema/rules(/|$)',
      message: 'apps/ may import @vp/domain-schema/wire (types) only; rules are backend-only.',
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

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'packages/domain-schema/generated/**',
      'contracts/pacts/**',
      '.llm-cassettes/**',
      // Non-production spikes are not linted (docs/decisions/; WU-03).
      'spikes/**',
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
    files: ['journeys/**/*.{ts,tsx,js,mjs}'],
    rules: {
      'no-restricted-imports': ['error', journeysRestrictedImports],
    },
  },
  prettier,
);
