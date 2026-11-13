// Pins the enforced commit types and scopes to CLAUDE.md §10. Changing either list is a
// deliberate policy change: update CLAUDE.md §10 and this test together.
import { describe, expect, it } from 'vitest';
import config, { SCOPES, TYPES } from '../commitlint.config.js';

describe('commitlint config', () => {
  it('allows exactly the CLAUDE.md §10 types', () => {
    expect([...TYPES].sort()).toEqual(
      ['build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf', 'refactor', 'test'].sort(),
    );
  });

  it('allows exactly the CLAUDE.md §10 scopes', () => {
    expect([...SCOPES].sort()).toEqual(
      [
        'api-nextjs',
        'contract',
        'domain-schema',
        'infra',
        'journeys',
        'usecases',
        'repo',
        'web',
      ].sort(),
    );
  });

  it('enforces both lists, requires a scope and caps the header at 72', () => {
    expect(config.rules).toMatchObject({
      'type-enum': [2, 'always', [...TYPES]],
      'scope-enum': [2, 'always', [...SCOPES]],
      'scope-empty': [2, 'never'],
      'header-max-length': [2, 'always', 72],
    });
  });
});
