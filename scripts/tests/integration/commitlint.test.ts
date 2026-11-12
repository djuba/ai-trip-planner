// Real @commitlint/lint + load against commitlint.config.js (CLAUDE.md §10; WU-02 DoD).
import lint from '@commitlint/lint';
import load from '@commitlint/load';
import type { LintOptions, QualifiedRules } from '@commitlint/types';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

let rules: QualifiedRules;
let options: LintOptions;

beforeAll(async () => {
  const loaded = await load({}, { cwd: repoRoot });
  rules = loaded.rules;
  options = {
    defaultIgnores: loaded.defaultIgnores,
    ignores: loaded.ignores,
    ...(loaded.parserPreset?.parserOpts ? { parserOpts: loaded.parserPreset.parserOpts } : {}),
  };
});

const check = (message: string) => lint(message, rules, options);

describe('commit messages', () => {
  it.each([
    'feat(web): add trip form',
    'fix(api-nextjs): map refusal to 502',
    'docs(repo): close WU-02',
    'build(repo): add vitest projects\n\nBody text.\n\nCo-Authored-By: Someone <x@example.com>',
    'feat(domain-schema)!: rename experience value\n\nBREAKING CHANGE: go-karts is now karting',
  ])('accepts %j', async (message) => {
    const result = await check(message);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it.each([
    ['non-conventional', 'added some stuff', 'type-empty'],
    ['unknown type', 'style(web): reformat', 'type-enum'],
    ['missing scope', 'feat: add trip form', 'scope-empty'],
    ['unknown scope', 'feat(frontend): add trip form', 'scope-enum'],
    ['removed scope', 'feat(api-go): add health route', 'scope-enum'],
    ['uppercase type', 'Feat(web): add trip form', 'type-case'],
    ['header over 72 chars', `feat(web): ${'a'.repeat(62)}`, 'header-max-length'],
  ])('rejects %s', async (_label, message, rule) => {
    const result = await check(message);
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.name)).toContain(rule);
  });

  it('ignores merge commits', async () => {
    const result = await check(
      'Merge pull request #3 from djuba/wu/WU-03-ai-sdk-structured-output-spike',
    );
    expect(result.valid).toBe(true);
  });
});
