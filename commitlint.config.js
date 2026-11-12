// Conventional Commits, enforced on `commit-msg` by lefthook (CLAUDE.md §10).
// TYPES and SCOPES are exported so scripts/commitlint-config.test.ts can pin them to §10.

/** @type {readonly string[]} */
export const TYPES = ['feat', 'fix', 'refactor', 'perf', 'test', 'docs', 'build', 'ci', 'chore'];

/** @type {readonly string[]} */
export const SCOPES = [
  'web',
  'api-nextjs',
  'domain-schema',
  'contract',
  'journeys',
  'usecases',
  'repo',
];

/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', [...TYPES]],
    'scope-enum': [2, 'always', [...SCOPES]],
    'scope-empty': [2, 'never'],
    'header-max-length': [2, 'always', 72],
  },
};
