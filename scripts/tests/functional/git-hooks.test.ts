// Runs the hook commands exactly as lefthook.yml declares them (read via `lefthook dump`) as
// real processes against a throwaway git repo: commit-msg rejects/accepts messages, and the
// gitleaks pre-commit scan blocks a staged secret (WU-02 DoD; CLAUDE.md §6.7, §10).
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const isWindows = process.platform === 'win32';

/**
 * This process's env without any GIT_* variable. A git hook (pre-push runs `pnpm verify`) exports
 * GIT_DIR, GIT_INDEX_FILE and others, and an inherited one makes git, gitleaks and commitlint act
 * on the real repository instead of the throwaway one. Windows env keys are case-insensitive.
 */
function childEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
}

function run(cmd: string, args: string[], cwd: string): SpawnSyncReturns<string> {
  const env = childEnv();
  // pnpm is a .cmd shim on Windows, which needs a shell to launch. A shell gets one quoted
  // command string, never an argument list (Node DEP0190).
  const result =
    isWindows && cmd === 'pnpm'
      ? spawnSync([cmd, ...args.map((a) => `"${a}"`)].join(' '), {
          cwd,
          env,
          encoding: 'utf8',
          shell: true,
        })
      : spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  if (result.error) throw result.error;
  return result;
}

interface Job {
  name: string;
  run: string;
  glob?: string[];
  stage_fixed?: boolean;
}
interface Hook {
  jobs: Job[];
  parallel?: boolean;
  piped?: boolean;
}
type LefthookConfig = Record<'commit-msg' | 'pre-commit' | 'pre-push', Hook>;

let config: LefthookConfig;

/** The `run` string of one job, split into argv with lefthook's placeholders substituted. */
function argv(hook: keyof LefthookConfig, job: string, vars: Record<string, string> = {}) {
  const found = config[hook].jobs.find((j) => j.name === job);
  if (!found) throw new Error(`lefthook.yml has no ${hook} job named ${job}`);
  const [cmd = '', ...args] = found.run.split(' ').map((part) => vars[part] ?? part);
  return { cmd, args };
}

beforeAll(() => {
  const validate = run('pnpm', ['exec', 'lefthook', 'validate'], repoRoot);
  expect(validate.status, validate.stdout + validate.stderr).toBe(0);
  const dump = run('pnpm', ['exec', 'lefthook', 'dump', '--format', 'json'], repoRoot);
  expect(dump.status, dump.stderr).toBe(0);
  config = JSON.parse(dump.stdout) as LefthookConfig;
}, 60_000);

// Built at runtime so this source file never contains a scannable token itself.
const FAKE_GITHUB_PAT = ['ghp', '_', 'R7kQ2vX9mL4pT8wZ1nB6cF3hJ5sD0gA2eYu'].join('');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vp-hooks-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('lefthook.yml', () => {
  it('declares the CLAUDE.md §6.7 hooks', () => {
    expect(config['commit-msg'].jobs.map((j) => j.name)).toEqual(['commitlint']);
    expect(config['pre-push'].jobs).toEqual([{ name: 'verify', run: 'pnpm verify' }]);
  });

  it('runs the pre-commit fixers sequentially, before the secret scan', () => {
    const preCommit = config['pre-commit'];
    // eslint --fix and prettier --write rewrite and re-stage the same files: never in parallel.
    expect(preCommit.parallel ?? false).toBe(false);
    expect(preCommit.piped).toBe(true);
    expect(preCommit.jobs.map((j) => j.name)).toEqual(['eslint', 'prettier', 'gitleaks']);
    expect(preCommit.jobs.filter((j) => j.stage_fixed).map((j) => j.name)).toEqual([
      'eslint',
      'prettier',
    ]);
  });
});

describe('commit-msg job: commitlint', () => {
  const commitlint = (message: string) => {
    const file = join(dir, 'COMMIT_EDITMSG');
    writeFileSync(file, `${message}\n`);
    const { cmd, args } = argv('commit-msg', 'commitlint', { '{1}': file });
    return run(cmd, args, repoRoot);
  };

  it('rejects a non-conventional message', () => {
    const result = commitlint('added some stuff');
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/type may not be empty/);
  });

  it('rejects a scope outside the CLAUDE.md §10 list', () => {
    expect(commitlint('feat(frontend): add trip form').status).not.toBe(0);
  });

  it('accepts a conventional message with a valid scope', () => {
    const result = commitlint('feat(web): add trip form');
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});

describe('pre-commit job: gitleaks', () => {
  // lefthook runs from the repo root; the scan runs inside the throwaway repo, so the script
  // path from lefthook.yml is resolved against the real root.
  const gitleaks = (cwd: string) => {
    const { cmd, args } = argv('pre-commit', 'gitleaks');
    return run(
      cmd,
      args.map((a) => (a.startsWith('scripts/') ? join(repoRoot, a) : a)),
      cwd,
    );
  };

  beforeEach(() => {
    run('git', ['init', '--quiet'], dir);
  });

  const stage = (name: string, content: string) => {
    writeFileSync(join(dir, name), content);
    run('git', ['add', name], dir);
  };

  it('blocks a staged file containing a secret', () => {
    stage('config.ts', `export const token = '${FAKE_GITHUB_PAT}';\n`);
    const result = gitleaks(dir);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/leaks found/i);
    // --redact: the secret itself is never echoed.
    expect(result.stdout + result.stderr).not.toContain(FAKE_GITHUB_PAT);
  });

  it('passes a staged file without secrets', () => {
    stage('config.ts', "export const greeting = 'hello';\n");
    const result = gitleaks(dir);
    expect(result.stdout + result.stderr).toMatch(/no leaks found/i);
    expect(result.status).toBe(0);
  });
});

// Run from a worktree's pre-push hook, git exports GIT_DIR (and GIT_INDEX_FILE) pointing at the
// real repository. On 2026-11-10 the inherited GIT_DIR made `git init` here set core.bare = true on
// it and `git add` stage a stray config.ts. A sentinel repo stands in for the real one.
describe('isolation from an inherited GIT_DIR', () => {
  let sentinel: string;

  beforeEach(() => {
    sentinel = mkdtempSync(join(tmpdir(), 'vp-hooks-sentinel-'));
    run('git', ['init', '--quiet'], sentinel);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(sentinel, { recursive: true, force: true });
  });

  it('runs git and gitleaks against the throwaway repo, leaving the GIT_DIR repo untouched', () => {
    vi.stubEnv('GIT_DIR', join(sentinel, '.git'));
    vi.stubEnv('GIT_INDEX_FILE', join(sentinel, '.git', 'index'));

    run('git', ['init', '--quiet'], dir);
    writeFileSync(join(dir, 'config.ts'), `export const token = '${FAKE_GITHUB_PAT}';\n`);
    run('git', ['add', 'config.ts'], dir);
    const { cmd, args } = argv('pre-commit', 'gitleaks');
    const scan = run(
      cmd,
      args.map((a) => (a.startsWith('scripts/') ? join(repoRoot, a) : a)),
      dir,
    );
    vi.unstubAllEnvs();

    expect(run('git', ['config', '--get', 'core.bare'], sentinel).stdout.trim()).toBe('false');
    expect(run('git', ['ls-files'], sentinel).stdout).toBe('');
    expect(existsSync(join(sentinel, 'config.ts'))).toBe(false);

    // The secret is staged only in the throwaway repo, so finding it proves the scan looked there.
    expect(scan.status).not.toBe(0);
    expect(scan.stdout + scan.stderr).toMatch(/leaks found/i);
  });
});
