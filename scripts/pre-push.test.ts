import { describe, expect, it } from 'vitest';
import { isDocFile, parsePushedRefs, planPush, type Git } from './pre-push.ts';

const ZERO = '0'.repeat(40);
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const BASE = 'c'.repeat(40);

/** A fake git whose diffs are keyed by `<base>..<head>`. */
function fakeGit(diffs: Record<string, string[]>, mergeBase: string | undefined = BASE): Git {
  return {
    mergeBaseWithMain: () => mergeBase,
    changedFiles: (base, head) => diffs[`${base}..${head}`],
  };
}

describe('parsePushedRefs', () => {
  it('reads the local and remote sha of each pushed ref, ignoring blank lines', () => {
    const stdin = `refs/heads/x ${A} refs/heads/x ${B}\r\n\nrefs/heads/y ${B} refs/heads/y ${ZERO}\n`;
    expect(parsePushedRefs(stdin)).toEqual([
      { localSha: A, remoteSha: B },
      { localSha: B, remoteSha: ZERO },
    ]);
  });
});

describe('isDocFile', () => {
  it('accepts Markdown anywhere but spec/', () => {
    expect(isDocFile('CLAUDE.md')).toBe(true);
    expect(isDocFile('docs/plans/WU-09.md')).toBe(true);
    expect(isDocFile('.claude/skills/start-wu/SKILL.md')).toBe(true);
    expect(isDocFile('spec/rules.md')).toBe(false);
    expect(isDocFile('scripts/verify.ts')).toBe(false);
    expect(isDocFile('.gitignore')).toBe(false);
  });
});

describe('planPush', () => {
  it('takes the docs path when every pushed file is Markdown outside spec/', () => {
    const git = fakeGit({ [`${B}..${A}`]: ['CLAUDE.md', 'docs/work-breakdown.md'] });
    expect(planPush([{ localSha: A, remoteSha: B }], git)).toEqual({
      kind: 'docs',
      files: ['CLAUDE.md', 'docs/work-breakdown.md'],
    });
  });

  it('runs the full gate when any file is not a doc', () => {
    const git = fakeGit({ [`${B}..${A}`]: ['CLAUDE.md', 'scripts/verify.ts'] });
    expect(planPush([{ localSha: A, remoteSha: B }], git)).toEqual({ kind: 'full' });
  });

  it('runs the full gate for a change to spec/ Markdown', () => {
    const git = fakeGit({ [`${B}..${A}`]: ['spec/normalize.md'] });
    expect(planPush([{ localSha: A, remoteSha: B }], git)).toEqual({ kind: 'full' });
  });

  it('compares a new branch against its merge base with main', () => {
    const git = fakeGit({ [`${BASE}..${A}`]: ['docs/plans/WU-09.md'] });
    expect(planPush([{ localSha: A, remoteSha: ZERO }], git)).toEqual({
      kind: 'docs',
      files: ['docs/plans/WU-09.md'],
    });
  });

  it('runs the full gate when there is no merge base or the diff fails', () => {
    expect(planPush([{ localSha: A, remoteSha: ZERO }], fakeGit({}, undefined))).toEqual({
      kind: 'full',
    });
    // The remote sha isn't in the local repo, so the diff fails.
    expect(planPush([{ localSha: A, remoteSha: B }], fakeGit({}))).toEqual({ kind: 'full' });
  });

  it('combines every pushed ref, so one code change anywhere means the full gate', () => {
    const git = fakeGit({ [`${B}..${A}`]: ['README.md'], [`${BASE}..${B}`]: ['package.json'] });
    const refs = [
      { localSha: A, remoteSha: B },
      { localSha: B, remoteSha: ZERO },
    ];
    expect(planPush(refs, git)).toEqual({ kind: 'full' });
  });

  it('ignores a deleted remote branch', () => {
    expect(planPush([{ localSha: ZERO, remoteSha: B }], fakeGit({}))).toEqual({
      kind: 'docs',
      files: [],
    });
  });
});
