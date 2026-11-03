// Runs the gitleaks secret scan (CLAUDE.md §6.7 pre-commit, §9). gitleaks is a native binary,
// not an npm package: install it once (`winget install Gitleaks.Gitleaks` / `brew install gitleaks`).
// A missing binary FAILS the hook; a skipped secret scan must never look like a passing one.
//
// Usage: node scripts/gitleaks.mjs [gitleaks args...]
// With no args, scans the staged diff of the repo in the current directory.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_ARGS = ['git', '--pre-commit', '--staged', '--redact', '--no-banner', '--verbose'];

/** Candidate binaries, in order: explicit override, PATH, winget's link dir (a terminal opened
 * before `winget install` has a stale PATH). */
function candidates() {
  const list = [];
  if (process.env.GITLEAKS_BIN) list.push(process.env.GITLEAKS_BIN);
  list.push('gitleaks');
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const winget = join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'gitleaks.exe');
    if (existsSync(winget)) list.push(winget);
  }
  return list;
}

const args = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_ARGS;

for (const bin of candidates()) {
  const result = spawnSync(bin, args, { stdio: 'inherit' });
  if (result.error && /** @type {NodeJS.ErrnoException} */ (result.error).code === 'ENOENT') {
    continue;
  }
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

console.error(
  [
    'gitleaks: binary not found, so the secret scan cannot run and the commit is blocked.',
    'Install it once:  winget install Gitleaks.Gitleaks   (Windows)',
    '                  brew install gitleaks              (macOS / Linux)',
    'or set GITLEAKS_BIN to the binary path. Then open a new terminal and retry.',
  ].join('\n'),
);
process.exit(1);
