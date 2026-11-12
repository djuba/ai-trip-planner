// lefthook `pre-push` (CLAUDE.md §6.7): runs the project gate, except for a push that changes only
// Markdown outside spec/, which gets a format check instead. spec/*.md is the rule and
// normalization source of truth, with fixtures behind it, so it always gets the full gate. CI runs
// the full gate on every pull request either way. When in doubt (a commit missing locally, no
// merge base), this falls back to the full gate.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ZERO_SHA = /^0+$/;

export interface PushedRef {
  localSha: string;
  remoteSha: string;
}

/** Parses git's pre-push stdin: `<local ref> <local sha> <remote ref> <remote sha>` per line. */
export function parsePushedRefs(stdin: string): PushedRef[] {
  return stdin
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields.length === 4)
    .map(([, localSha = '', , remoteSha = '']) => ({ localSha, remoteSha }));
}

/** True for Markdown outside spec/. */
export const isDocFile = (path: string) => path.endsWith('.md') && !path.startsWith('spec/');

export interface Git {
  /** The merge base of a commit and the main branch, or undefined if there is none. */
  mergeBaseWithMain(sha: string): string | undefined;
  /** Files changed between two commits (`git diff --name-only`), or undefined on error. */
  changedFiles(base: string, head: string): string[] | undefined;
}

export type PushPlan = { kind: 'full' } | { kind: 'docs'; files: string[] };

export function planPush(refs: PushedRef[], git: Git): PushPlan {
  const files = new Set<string>();
  for (const { localSha, remoteSha } of refs) {
    // A deleted remote branch pushes nothing to check.
    if (ZERO_SHA.test(localSha)) continue;
    // A new remote branch: compare against where it left main.
    const base = ZERO_SHA.test(remoteSha) ? git.mergeBaseWithMain(localSha) : remoteSha;
    if (!base) return { kind: 'full' };
    const changed = git.changedFiles(base, localSha);
    if (!changed) return { kind: 'full' };
    for (const file of changed) files.add(file);
  }
  const list = [...files];
  return list.every(isDocFile) ? { kind: 'docs', files: list } : { kind: 'full' };
}

function gitOutput(args: string[]): string | undefined {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

const realGit: Git = {
  mergeBaseWithMain: (sha) => gitOutput(['merge-base', sha, 'origin/main']),
  changedFiles: (base, head) => {
    const out = gitOutput(['diff', '--name-only', '--no-renames', base, head]);
    return out === undefined ? undefined : out.split('\n').filter(Boolean);
  },
};

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PRETTIER_BIN = join(
  dirname(createRequire(import.meta.url).resolve('prettier/package.json')),
  'bin',
  'prettier.cjs',
);

function run(args: string[]): number {
  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  return result.status ?? 1;
}

function main(): number {
  const plan = planPush(parsePushedRefs(readFileSync(0, 'utf8')), realGit);
  if (plan.kind === 'full') {
    // pnpm is a .cmd shim on Windows, which needs a shell to launch.
    const result = spawnSync('pnpm verify', { cwd: ROOT, stdio: 'inherit', shell: true });
    return result.status ?? 1;
  }
  console.log(
    `pre-push: only Markdown outside spec/ changed; format check instead of pnpm verify.`,
  );
  // Like `pnpm verify`, this checks the working tree; deleted files have nothing left to check.
  const present = plan.files.filter((file) => existsSync(join(ROOT, file)));
  if (present.length === 0) return 0;
  return run([PRETTIER_BIN, '--check', ...present]);
}

// Run as a script, not when a test imports this module.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
